/**
 * Intentional Things Finder - Recommendation API
 *
 * Hybrid search API combining structured filtering + vector similarity
 */

import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ============================================================
// Helper Functions
// ============================================================

// Get current time of day
function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

// Vibe scoring (matching logic from MVP)
function calculateVibeScore(activity, preferences) {
  const quietMatch = 1 - Math.abs((activity.vibe_quiet || 0.5) - preferences.quietSocial);
  const insideMatch = 1 - Math.abs((activity.vibe_inside || 0.5) - preferences.insideOutside);
  return (quietMatch * 30) + (insideMatch * 30);
}

// Time of day bonus
function calculateTimeBonus(activity, currentTime) {
  if (!activity.best_times) return 0;
  return activity.best_times.includes(currentTime) ? 20 : 0;
}

// Time constraint check
function checkTimeConstraint(activity, preferences) {
  if (activity.type === 'place' && activity.walk_minutes_from_center) {
    const totalTimeNeeded = activity.walk_minutes_from_center * 2 + 30;
    return totalTimeNeeded <= preferences.timeAvailable;
  }
  return true; // Events don't have travel time constraint
}

// ============================================================
// API Endpoints
// ============================================================

/**
 * GET /api/health
 * Health check
 */
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: result.rows[0].now,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
});

/**
 * POST /api/recommendations
 * Get personalized recommendations based on preferences
 *
 * Body:
 * {
 *   timeAvailable: 120,        // minutes
 *   quietSocial: 0.7,          // 0-1 scale
 *   insideOutside: 0.5,        // 0-1 scale
 *   kidFriendly: false,
 *   lowEnergy: true,
 *   city: 'madison'            // optional, defaults to madison
 * }
 */
app.post('/api/recommendations', async (req, res) => {
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
            score += (1 - timeRatio) * 10; // bonus for being comfortably within time
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

    res.json({
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
});

/**
 * GET /api/activities/:id
 * Get details for a specific activity
 */
app.get('/api/activities/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;

    const table = type === 'place' ? 'places' : 'events';
    const result = await pool.query(
      `SELECT * FROM ${table} WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    res.json(result.rows[0]);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/feedback
 * Record user feedback on recommendations
 */
app.post('/api/feedback', async (req, res) => {
  try {
    const { recommendationId, selectedId, selectedType, rating } = req.body;

    if (!recommendationId || !selectedId || !selectedType) {
      return res.status(400).json({
        error: 'Missing required fields: recommendationId, selectedId, selectedType',
      });
    }

    await pool.query(`
      UPDATE recommendations
      SET
        selected_id = $1,
        selected_type = $2,
        feedback_rating = $3
      WHERE id = $4
    `, [selectedId, selectedType, rating || null, recommendationId]);

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stats
 * Get database statistics
 */
app.get('/api/stats', async (req, res) => {
  try {
    const placesCount = await pool.query('SELECT COUNT(*) FROM places WHERE is_active = TRUE');
    const eventsCount = await pool.query('SELECT COUNT(*) FROM events WHERE is_active = TRUE AND start_time > NOW()');
    const recommendationsCount = await pool.query('SELECT COUNT(*) FROM recommendations');

    const eventsBySource = await pool.query(`
      SELECT source, COUNT(*) as count
      FROM events
      WHERE is_active = TRUE AND start_time > NOW()
      GROUP BY source
    `);

    const upcomingEvents = await pool.query(`
      SELECT
        DATE_TRUNC('week', start_time) as week,
        COUNT(*) as count
      FROM events
      WHERE is_active = TRUE AND start_time > NOW()
      GROUP BY week
      ORDER BY week
      LIMIT 4
    `);

    res.json({
      places: parseInt(placesCount.rows[0].count),
      events: parseInt(eventsCount.rows[0].count),
      recommendations: parseInt(recommendationsCount.rows[0].count),
      eventsBySou: eventsBySource.rows,
      upcomingEvents: upcomingEvents.rows,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Start Server
// ============================================================

app.listen(PORT, () => {
  console.log(`🚀 Intentional Things API running on http://localhost:${PORT}`);
  console.log(`📍 Endpoints:`);
  console.log(`   GET  /api/health`);
  console.log(`   POST /api/recommendations`);
  console.log(`   GET  /api/activities/:type/:id`);
  console.log(`   POST /api/feedback`);
  console.log(`   GET  /api/stats`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await pool.end();
  process.exit(0);
});
