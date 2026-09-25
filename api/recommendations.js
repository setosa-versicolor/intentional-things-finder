/**
 * POST /api/recommendations
 * Get personalized recommendations based on preferences
 */

import { getPool } from './_lib/db.js';
import { generatePreferenceEmbedding } from './_lib/embeddings.js';
import { getTodaysHours } from './_lib/hours.js';
import { buildContext, rankActivities } from './_lib/recommend.js';
import { getDayOfWeek } from './_lib/time.js';

const MAX_LIMIT = 10;
const MAX_DAYS_AHEAD = 14;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

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
    e.source_url
  FROM activities a
  LEFT JOIN places p ON a.type = 'place' AND p.id = a.id
  LEFT JOIN events e ON a.type = 'event' AND e.id = a.id
  WHERE
    a.city_id = $1
    AND a.is_active = TRUE
    AND (a.business_status IS NULL OR a.business_status = 'OPERATIONAL')
`;

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
    };
    const city = typeof body.city === 'string' ? body.city : 'madison';
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(body.limit, 10) || 3));
    const requestedDate = parseRequestedDate(body.date);

    const pool = getPool();

    const cityResult = await pool.query('SELECT id FROM cities WHERE slug = $1', [city]);
    if (cityResult.rows.length === 0) {
      return res.status(404).json({ error: `City '${city}' not found` });
    }
    const cityId = cityResult.rows[0].id;

    const [activities, semanticScores] = await Promise.all([
      pool.query(ACTIVITIES_QUERY, [cityId]),
      getSemanticScores(pool, cityId, preferences),
    ]);

    const context = buildContext({ date: requestedDate, semanticScores });
    const ranked = rankActivities(activities.rows, preferences, context, limit)
      .map(activity => ({
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
          })),
          preferences: {
            ...preferences,
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
        totalCandidates: activities.rows.length,
        filteredCount: ranked.length,
      },
    });

  } catch (err) {
    console.error('Recommendation error:', err);
    res.status(500).json({ error: 'Could not get recommendations' });
  }
}
