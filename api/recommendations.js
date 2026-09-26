/**
 * POST /api/recommendations
 * Get personalized recommendations based on preferences
 */

import { getPool } from './_lib/db.js';
import { generatePreferenceEmbedding } from './_lib/embeddings.js';
import { getTodaysHours } from './_lib/hours.js';
import { buildContext, recommend, ROLES } from './_lib/recommend.js';
import { getDayOfWeek } from './_lib/time.js';
import { getHourlyForecast, weatherAt } from './_lib/weather.js';
import { applyTriage } from './_lib/event-triage.js';

const MAX_LIMIT = 10;
const MAX_DAYS_AHEAD = 14;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

// Anywhere within ~60 km of the Capitol counts as "in Madison"
const MADISON = { lat: 43.0747, lng: -89.3841 };
function parseOrigin(origin) {
  const lat = Number(origin?.lat);
  const lng = Number(origin?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat - MADISON.lat) > 0.55 || Math.abs(lng - MADISON.lng) > 0.75) return null;
  return { lat, lng };
}

// "place-12" / "event-7" keys from the client, capped so a request stays small
const parseKeys = (keys, max = 200) => (Array.isArray(keys) ? keys : [])
  .filter(k => typeof k === 'string' && /^(place|event)-\d+$/.test(k))
  .slice(0, max);

/**
 * Read the requested start time, defaulting to now and never earlier than now
 */
function parseRequestedDate(date) {
  const now = new Date();
  if (!date) return now;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime()) || parsed < now) return now;
  const max = new Date(now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000);
  return parsed > max ? max : parsed;
}

// seasons, best_times and the event venue/url live on the base tables, not the view
const ACTIVITIES_QUERY = `
  SELECT
    a.type,
    a.id,
    a.title,
    a.neighborhood,
    a.lat,
    a.lng,
    a.vibe_quiet,
    a.vibe_inside,
    a.vibe_active,
    a.description,
    a.nudge,
    a.kid_friendly,
    a.low_energy,
    a.tags,
    a.walk_minutes_from_center,
    a.start_time,
    a.end_time,
    a.venue_name,
    a.source,
    a.price_level,
    a.google_place_id,
    a.google_rating,
    a.google_user_ratings_total,
    a.hours,
    a.business_status,
    p.type AS category,
    p.seasons,
    p.best_times,
    e.venue_address,
    e.source_url,
    __TRIAGE__
  FROM activities a
  LEFT JOIN places p ON a.type = 'place' AND p.id = a.id
  LEFT JOIN events e ON a.type = 'event' AND e.id = a.id
  WHERE
    a.city_id = $1
    AND a.is_active = TRUE
    AND (a.business_status IS NULL OR a.business_status = 'OPERATIONAL')
`;

// Migration 011 adds events.triage; until it's applied, carry on without it.
// A "yes" is cached for good, a "no" is rechecked every few minutes.
let triageColumn = { present: false, checkedAt: 0 };
async function activitiesQuery(pool) {
  if (!triageColumn.present && Date.now() - triageColumn.checkedAt > 5 * 60 * 1000) {
    const { rows } = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'events' AND column_name = 'triage'
    `);
    triageColumn = { present: rows.length > 0, checkedAt: Date.now() };
  }
  return ACTIVITIES_QUERY.replace('__TRIAGE__', triageColumn.present ? 'e.triage' : 'NULL::jsonb AS triage');
}

async function getSemanticScores(pool, cityId, preferences) {
  const semanticScores = new Map();

  try {
    const userEmbedding = await generatePreferenceEmbedding(preferences);
    if (!userEmbedding) return semanticScores;

    // pgvector's <=> is cosine distance, lower is better
    const similarities = await pool.query(`
      SELECT id, type, 1 - (embedding <=> $1::vector) as similarity
      FROM activities
      WHERE city_id = $2 AND is_active = TRUE AND embedding IS NOT NULL
    `, [JSON.stringify(userEmbedding), cityId]);

    similarities.rows.forEach(row => {
      semanticScores.set(`${row.type}-${row.id}`, parseFloat(row.similarity));
    });
  } catch (err) {
    console.warn('⚠️  Semantic scoring unavailable:', err.message);
  }

  return semanticScores;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const timeAvailable = Number(body.timeAvailable);
    const quietToLively = Number(body.quietToLively);
    const activeToRelaxing = Number(body.activeToRelaxing);

    if ([timeAvailable, quietToLively, activeToRelaxing].some(Number.isNaN) ||
        body.timeAvailable === undefined || body.quietToLively === undefined ||
        body.activeToRelaxing === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: timeAvailable, quietToLively, activeToRelaxing',
      });
    }

    const preferences = {
      timeAvailable: Math.max(15, timeAvailable),
      quietToLively: clamp01(quietToLively),
      activeToRelaxing: clamp01(activeToRelaxing),
      location: ['inside', 'outside'].includes(body.location) ? body.location : 'either',
      tags: Array.isArray(body.tags) ? body.tags.filter(t => typeof t === 'string') : [],
      origin: parseOrigin(body.origin),
      exclude: parseKeys(body.exclude),
      recent: parseKeys(body.recent),
      disliked: parseKeys(body.disliked),
    };
    // Swapping one card: which slot, and which kinds are already on screen
    const role = ROLES.includes(body.role) ? body.role : null;
    const avoidCategories = (Array.isArray(body.avoidCategories) ? body.avoidCategories : [])
      .filter(c => typeof c === 'string').slice(0, 10);
    const city = typeof body.city === 'string' ? body.city : 'madison';
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(body.limit, 10) || 3));
    const requestedDate = parseRequestedDate(body.date);

    const pool = getPool();

    const cityResult = await pool.query('SELECT id FROM cities WHERE slug = $1', [city]);
    if (cityResult.rows.length === 0) {
      return res.status(404).json({ error: `City '${city}' not found` });
    }
    const cityId = cityResult.rows[0].id;

    const [activities, semanticScores, forecast] = await Promise.all([
      activitiesQuery(pool).then(query => pool.query(query, [cityId])),
      getSemanticScores(pool, cityId, preferences),
      getHourlyForecast(),
    ]);

    const weather = weatherAt(forecast, requestedDate);
    const context = buildContext({ date: requestedDate, semanticScores, weather });
    const candidates = activities.rows.map(row => applyTriage(row));
    const ranked = recommend(candidates, preferences, context, { count: limit, role, avoidCategories })
      .map(({ triage, ...activity }) => ({
        ...activity,
        hours_today: getTodaysHours(activity.hours, requestedDate),
      }));

    const dayOfWeek = getDayOfWeek(requestedDate);

    // Log the recommendation so feedback can be attached to it later
    let recommendationId = null;
    try {
      const logged = await pool.query(`
        INSERT INTO recommendations (
          city_id,
          time_available,
          quiet_social,
          inside_outside,
          kid_friendly,
          low_energy,
          requested_at,
          time_of_day,
          day_of_week,
          results
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9)
        RETURNING id
      `, [
        cityId,
        preferences.timeAvailable,
        preferences.quietToLively, // Map to quiet_social for now (schema compatibility)
        preferences.activeToRelaxing, // Map to inside_outside for now (will update schema later)
        preferences.tags.includes('kid-friendly'),
        preferences.activeToRelaxing < 0.3,
        context.timeOfDay,
        dayOfWeek,
        JSON.stringify({
          results: ranked.map((a, i) => ({
            type: a.type,
            id: a.id,
            score: a.score,
            rank: i + 1,
            role: a.role,
          })),
          // Where someone is and what they've done stays on their device
          preferences: {
            timeAvailable: preferences.timeAvailable,
            quietToLively: preferences.quietToLively,
            activeToRelaxing: preferences.activeToRelaxing,
            location: preferences.location,
            tags: preferences.tags,
            usedLocation: preferences.origin !== null,
            role,
            date: requestedDate.toISOString(),
          },
        }),
      ]);
      recommendationId = logged.rows[0]?.id ?? null;
    } catch (err) {
      // Logging must never cost the user their suggestions
      console.warn('⚠️  Failed to log recommendation:', err.message);
    }

    res.status(200).json({
      recommendations: ranked,
      metadata: {
        recommendationId,
        requestedAt: requestedDate.toISOString(),
        timeOfDay: context.timeOfDay,
        season: context.season,
        dayOfWeek,
        conditions: {
          weather: weather && {
            temperature: weather.temperature,
            shortForecast: weather.shortForecast,
            precipChance: weather.precipChance,
            rating: weather.rating,
          },
          sunset: context.sun.sunset.toISOString(),
          dusk: context.sun.dusk.toISOString(),
        },
        totalCandidates: activities.rows.length,
        filteredCount: ranked.length,
      },
    });

  } catch (err) {
    console.error('Recommendation error:', err);
    res.status(500).json({ error: 'Could not get recommendations' });
  }
}
