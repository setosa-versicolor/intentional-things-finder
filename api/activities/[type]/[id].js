/**
 * GET /api/activities/:type/:id
 * Get details for a specific activity
 */

import { getPool } from '../../_lib/db.js';

const TABLES = { place: 'places', event: 'events' };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, id } = req.query;
    const table = TABLES[type];
    const numericId = parseInt(id, 10);

    if (!table || Number.isNaN(numericId)) {
      return res.status(400).json({ error: 'Expected /api/activities/(place|event)/:id' });
    }

    const pool = getPool();
    const result = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [numericId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    const { embedding, ...activity } = result.rows[0];
    res.status(200).json(activity);

  } catch (err) {
    console.error('Activity lookup error:', err);
    res.status(500).json({ error: 'Could not load activity' });
  }
}
