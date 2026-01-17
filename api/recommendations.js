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
        price_level
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

    // Score each activity
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

        return true;
      })
      .map(activity => {
        let score = 0;

        // Vibe matching (60 points total)
        // Quiet/Lively atmosphere (30 points)
        const quietMatch = 1 - Math.abs((activity.vibe_quiet || 0.5) - quietToLively);
        score += quietMatch * 30;

        // Relaxing/Active energy (30 points)
        const activeMatch = 1 - Math.abs((activity.vibe_active || 0.5) - activeToRelaxing);
        score += activeMatch * 30;

        // Time of day bonus (20 points)
        score += calculateTimeBonus(activity, currentTime);

        // Tag matching (up to 40 points)
        if (tags.length > 0 && activity.tags) {
          const activityTags = Array.isArray(activity.tags) ? activity.tags : [];
          const matchingTags = tags.filter(tag => activityTags.includes(tag));
          const tagBonus = (matchingTags.length / tags.length) * 40;
          score += tagBonus;
        }

        // Time availability bonus (comfortable fit, up to 10 points)
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
