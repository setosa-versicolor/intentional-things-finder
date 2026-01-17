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

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      timeAvailable,
      quietSocial,
      insideOutside,
      kidFriendly,
      lowEnergy,
      city = 'madison',
      limit = 3,
    } = req.body;

    // Validate inputs
    if (timeAvailable === undefined || quietSocial === undefined || insideOutside === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: timeAvailable, quietSocial, insideOutside',
      });
    }

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

    // Build SQL query with filters
    const query = `
      SELECT
        type,
        id,
        title,
        neighborhood,
        lat,
        lng,
        vibe_quiet,
        vibe_inside,
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
        price_level
      FROM activities
      WHERE
        city_id = $1
        AND is_active = TRUE
        AND ($2 = FALSE OR kid_friendly = TRUE)
    `;

    const params = [cityId, kidFriendly];
    const activities = await pool.query(query, params);

    // Score each activity
    const scored = activities.rows
      .filter(activity => checkTimeConstraint(activity, { timeAvailable }))
      .map(activity => {
        let score = 0;

        // Vibe matching (60 points)
        score += calculateVibeScore(activity, { quietSocial, insideOutside });

        // Time of day bonus (20 points)
        score += calculateTimeBonus(activity, currentTime);

        // Low energy penalty
        if (lowEnergy && !activity.low_energy) {
          score -= 15;
        }

        // Time availability bonus (comfortable fit)
        if (activity.walk_minutes_from_center) {
          const totalTime = activity.walk_minutes_from_center * 2 + 30;
          const timeRatio = totalTime / timeAvailable;
          if (timeRatio <= 0.8) {
            score += (1 - timeRatio) * 10;
          }
        }

        // Randomness for variety (10 points)
        score += Math.random() * 10;

        return {
          ...activity,
          score: Math.round(score * 10) / 10,
        };
      })
      .filter(activity => activity.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Log recommendation
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
      quietSocial,
      insideOutside,
      kidFriendly,
      lowEnergy,
      currentTime,
      currentDay,
      JSON.stringify(scored.map((a, i) => ({
        type: a.type,
        id: a.id,
        score: a.score,
        rank: i + 1,
      }))),
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
