-- Migration 010: Keep running events in the activities view
-- All-day and multi-hour events used to disappear 2 hours after they started,
-- so festivals and exhibits vanished while still going on.

DROP VIEW IF EXISTS activities;

CREATE VIEW activities AS
SELECT
  'place' AS type,
  p.id,
  p.city_id,
  p.name AS title,
  p.neighborhood,
  p.lat,
  p.lng,
  p.vibe_quiet,
  p.vibe_inside,
  p.vibe_active,
  p.story AS description,
  p.nudge,
  p.kid_friendly,
  p.low_energy,
  p.tags,
  p.walk_minutes_from_center,
  NULL::TIMESTAMPTZ AS start_time,
  NULL::TIMESTAMPTZ AS end_time,
  p.embedding,
  p.is_active,
  p.price_level,
  NULL::TEXT AS venue_name,
  NULL::TEXT AS source,
  p.google_place_id,
  p.google_rating,
  p.google_user_ratings_total,
  p.hours,
  p.business_status
FROM places p

UNION ALL

SELECT
  'event' AS type,
  e.id,
  e.city_id,
  e.title,
  e.neighborhood,
  e.lat,
  e.lng,
  e.vibe_quiet,
  e.vibe_inside,
  e.vibe_active,
  e.description,
  NULL AS nudge,
  e.kid_friendly,
  e.low_energy,
  e.tags,
  NULL AS walk_minutes_from_center,
  e.start_time,
  e.end_time,
  e.embedding,
  e.is_active,
  NULL AS price_level,
  e.venue_name,
  e.source,
  NULL AS google_place_id,
  NULL AS google_rating,
  NULL AS google_user_ratings_total,
  NULL::JSONB AS hours,
  'OPERATIONAL' AS business_status
FROM events e
-- Still running, or started within the last 2 hours if there's no end time
WHERE COALESCE(e.end_time, e.start_time + INTERVAL '2 hours') > NOW();

COMMENT ON VIEW activities IS 'Unified view of places and events for recommendations; events stay visible while they are running';
