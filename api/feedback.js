/**
 * POST /api/feedback
 * Record user feedback on recommendations
 */

import { getPool } from './_lib/db.js';

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { recommendationId, selectedId, selectedType, rating } = req.body;

    if (!recommendationId || !selectedId || !selectedType) {
      return res.status(400).json({
        error: 'Missing required fields: recommendationId, selectedId, selectedType',
      });
    }

    const pool = getPool();

    await pool.query(`
      UPDATE recommendations
      SET
        selected_id = $1,
        selected_type = $2,
        feedback_rating = $3
      WHERE id = $4
    `, [selectedId, selectedType, rating || null, recommendationId]);

    res.status(200).json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
