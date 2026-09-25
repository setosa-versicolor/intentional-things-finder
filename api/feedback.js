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
    const { recommendationId, selectedId, selectedType, rating } = req.body || {};

    if (!recommendationId || !selectedId || !['place', 'event'].includes(selectedType)) {
      return res.status(400).json({
        error: 'Missing required fields: recommendationId, selectedId, selectedType',
      });
    }

    const parsedRating = rating === null || rating === undefined ? null : parseInt(rating, 10);
    if (parsedRating !== null && !(parsedRating >= 1 && parsedRating <= 5)) {
      return res.status(400).json({ error: 'rating must be between 1 and 5' });
    }

    const pool = getPool();

    await pool.query(`
      UPDATE recommendations
      SET
        selected_id = $1,
        selected_type = $2,
        feedback_rating = $3
      WHERE id = $4
    `, [selectedId, selectedType, parsedRating, recommendationId]);

    res.status(200).json({ success: true });

  } catch (err) {
    console.error('Feedback error:', err);
    res.status(500).json({ error: 'Could not record feedback' });
  }
}
