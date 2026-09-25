/**
 * Intentional Things Finder - local development API server
 *
 * Serves the same handlers Vercel deploys from api/*.js, so local
 * development and production never drift apart.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import health from './health.js';
import recommendations from './recommendations.js';
import feedback from './feedback.js';
import stats from './stats.js';
import activityDetails from './activities/[type]/[id].js';
import { getPool } from './_lib/db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Vercel exposes dynamic path segments on req.query
const withParams = (handler) => (req, res) => {
  req.query = { ...req.query, ...req.params };
  return handler(req, res);
};

app.all('/api/health', health);
app.all('/api/recommendations', recommendations);
app.all('/api/feedback', feedback);
app.all('/api/stats', stats);
app.all('/api/activities/:type/:id', withParams(activityDetails));

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
  await getPool().end();
  process.exit(0);
});
