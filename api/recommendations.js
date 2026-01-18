/**
 * POST /api/recommendations
 * Get personalized recommendations based on preferences
 */

import {
  getPool,
  getTimeOfDay,
  calculateVibeScore,
  calculateTimeBonus,
  checkTimeConstraint,
} from './_lib/db.js';
import { generatePreferenceEmbedding } from './_lib/embeddings.js';
import { isCurrentlyOpen } from './_lib/hours.js';

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      timeAvailable,
      quietToLively,
      activeToRelaxing,
      location,
      tags = [],
      date,
      city = 'madison',
      limit = 3,
    } = req.body;

    // Validate inputs
    if (timeAvailable === undefined || quietToLively === undefined || activeToRelaxing === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: timeAvailable, quietToLively, activeToRelaxing',
      });
    }

    // Parse date filter
    const requestedDate = date ? new Date(date) : new Date();

    const pool = getPool();

    // Get city_id
    const cityResult = await pool.query(
      'SELECT id FROM cities WHERE slug = $1',
      [city]
    );

    if (cityResult.rows.length === 0) {
      return res.status(404).json({ error: `City '${city}' not found` });
    }

    const cityId = cityResult.rows[0].id;
    const currentTime = getTimeOfDay();
    const currentDay = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

    // Build SQL query with location filter
    let query = `
      SELECT
        type,
        id,
        title,
        neighborhood,
        lat,
        lng,
        vibe_quiet,
        vibe_inside,
        vibe_active,
        description,
        nudge,
        kid_friendly,
        low_energy,
        tags,
        walk_minutes_from_center,
        start_time,
        end_time,
        venue_name,
        source,
        price_level,
        google_place_id,
        google_rating,
        google_user_ratings_total,
        hours
      FROM activities
      WHERE
        city_id = $1
        AND is_active = TRUE
    `;

    const params = [cityId];

    // Add location filter if not "either"
    if (location === 'inside') {
      query += ' AND vibe_inside >= 0.6';
    } else if (location === 'outside') {
      query += ' AND vibe_inside <= 0.4';
    }

    const activities = await pool.query(query, params);

    // Generate embedding for user preferences (for semantic matching)
    let userEmbedding = null;
    let semanticScores = new Map();

    try {
      userEmbedding = await generatePreferenceEmbedding({
        quietToLively,
        activeToRelaxing,
        location,
        tags
      });

      if (userEmbedding) {
        // Calculate cosine similarity for all activities with embeddings
        // Using pgvector's <=> operator (cosine distance, lower is better)
        const similarities = await pool.query(`
          SELECT id, type, 1 - (embedding <=> $1::vector) as similarity
          FROM activities
          WHERE city_id = $2 AND is_active = TRUE AND embedding IS NOT NULL
        `, [JSON.stringify(userEmbedding), cityId]);

        // Store similarities in a map for quick lookup
        similarities.rows.forEach(row => {
          const key = `${row.type}-${row.id}`;
          semanticScores.set(key, row.similarity);
        });

        console.log(`✅ Generated semantic scores for ${similarities.rows.length} activities`);
      }
    } catch (err) {
      console.warn('⚠️  Semantic scoring unavailable:', err.message);
      // Continue without semantic scoring
    }

    // Score each activity (hybrid approach)
    const scored = activities.rows
      .filter(activity => {
        // Time constraint check
        if (!checkTimeConstraint(activity, { timeAvailable })) {
          return false;
        }

        // Date/time filter for events
        if (activity.type === 'event' && activity.start_time) {
          const eventStart = new Date(activity.start_time);
          if (eventStart < requestedDate) {
            return false;
          }
        }

        // Hours check for places - filter out places that are currently closed
        if (activity.type === 'place' && activity.hours) {
          if (!isCurrentlyOpen(activity.hours)) {
            return false;
          }
        }

        return true;
      })
      .map(activity => {
        let score = 0;
        let breakdown = {}; // For debugging

        // Vibe matching (40% weight = 40 points)
        // Quiet/Lively atmosphere (20 points)
        const quietMatch = 1 - Math.abs((activity.vibe_quiet || 0.5) - quietToLively);
        const quietScore = quietMatch * 20;
        score += quietScore;
        breakdown.quietScore = Math.round(quietScore * 10) / 10;

        // Relaxing/Active energy (20 points)
        const activeMatch = 1 - Math.abs((activity.vibe_active || 0.5) - activeToRelaxing);
        const activeScore = activeMatch * 20;
        score += activeScore;
        breakdown.activeScore = Math.round(activeScore * 10) / 10;

        // Tag matching (30% weight = 30 points)
        let tagScore = 0;
        if (tags.length > 0 && activity.tags) {
          const activityTags = Array.isArray(activity.tags) ? activity.tags : [];
          const matchingTags = tags.filter(tag => activityTags.includes(tag));
          tagScore = (matchingTags.length / tags.length) * 30;
          score += tagScore;
        }
        breakdown.tagScore = Math.round(tagScore * 10) / 10;

        // Semantic similarity (30% weight = 30 points)
        // Only applies if embeddings are available
        let semanticScore = 0;
        if (semanticScores.size > 0) {
          const key = `${activity.type}-${activity.id}`;
          const similarity = semanticScores.get(key);
          if (similarity !== undefined) {
            semanticScore = similarity * 30; // 0-1 similarity -> 0-30 points
            score += semanticScore;
          }
        }
        breakdown.semanticScore = Math.round(semanticScore * 10) / 10;

        // Time of day bonus (15 points)
        const timeBonus = calculateTimeBonus(activity, currentTime);
        score += timeBonus;
        breakdown.timeBonus = timeBonus;

        // Time availability bonus (comfortable fit, up to 10 points)
        let availabilityScore = 0;
        if (activity.walk_minutes_from_center) {
          const totalTime = activity.walk_minutes_from_center * 2 + 30;
          const timeRatio = totalTime / timeAvailable;
          if (timeRatio <= 0.8) {
            availabilityScore = (1 - timeRatio) * 10;
            score += availabilityScore;
          }
        }
        breakdown.availabilityScore = Math.round(availabilityScore * 10) / 10;

        // Randomness for variety (5 points)
        const randomBonus = Math.random() * 5;
        score += randomBonus;
        breakdown.randomBonus = Math.round(randomBonus * 10) / 10;

        return {
          ...activity,
          score: Math.round(score * 10) / 10,
          scoreBreakdown: breakdown, // Include for debugging
        };
      })
      .filter(activity => activity.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Log recommendation with new format
    await pool.query(`
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
    `, [
      cityId,
      timeAvailable,
      quietToLively, // Map to quiet_social for now (schema compatibility)
      activeToRelaxing, // Map to inside_outside for now (will update schema later)
      tags.includes('kid-friendly'), // Map to kid_friendly boolean
      tags.includes('relaxing') || activeToRelaxing < 0.3, // Map to low_energy
      currentTime,
      currentDay,
      JSON.stringify({
        results: scored.map((a, i) => ({
          type: a.type,
          id: a.id,
          score: a.score,
          rank: i + 1,
        })),
        preferences: {
          quietToLively,
          activeToRelaxing,
          location,
          tags,
          date: requestedDate.toISOString(),
        }
      }),
    ]);

    res.status(200).json({
      recommendations: scored,
      metadata: {
        timeOfDay: currentTime,
        dayOfWeek: currentDay,
        totalCandidates: activities.rows.length,
        filteredCount: scored.length,
      },
    });

  } catch (err) {
    console.error('Recommendation error:', err);
    res.status(500).json({ error: err.message });
  }
}
