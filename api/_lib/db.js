/**
 * Shared database connection for Vercel serverless functions
 * Uses connection pooling with environment variables from Vercel Postgres
 */

import pg from 'pg';

const { Pool } = pg;

// Create a single pool instance that will be reused across function invocations
let pool;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

// Helper: Get current time of day
export function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

// Helper: Vibe scoring
export function calculateVibeScore(activity, preferences) {
  const quietMatch = 1 - Math.abs((activity.vibe_quiet || 0.5) - preferences.quietSocial);
  const insideMatch = 1 - Math.abs((activity.vibe_inside || 0.5) - preferences.insideOutside);
  return (quietMatch * 30) + (insideMatch * 30);
}

// Helper: Time of day bonus
export function calculateTimeBonus(activity, currentTime) {
  if (!activity.best_times) return 0;
  return activity.best_times.includes(currentTime) ? 20 : 0;
}

// Helper: Time constraint check
export function checkTimeConstraint(activity, preferences) {
  if (activity.type === 'place' && activity.walk_minutes_from_center) {
    const totalTimeNeeded = activity.walk_minutes_from_center * 2 + 30;
    return totalTimeNeeded <= preferences.timeAvailable;
  }
  return true;
}
