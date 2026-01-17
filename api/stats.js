/**
 * GET /api/stats
 * Get database statistics
 */

import { getPool } from './_lib/db.js';

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const pool = getPool();

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

    res.status(200).json({
      places: parseInt(placesCount.rows[0].count),
      events: parseInt(eventsCount.rows[0].count),
      recommendations: parseInt(recommendationsCount.rows[0].count),
      eventsBySource: eventsBySource.rows,
      upcomingEvents: upcomingEvents.rows,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
