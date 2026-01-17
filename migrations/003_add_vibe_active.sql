-- Migration 003: Add vibe_active column and update tags
-- Adds the new "active/relaxing" vibe dimension to places and events

-- ============================================================
-- Add vibe_active column to places
-- ============================================================
ALTER TABLE places
ADD COLUMN vibe_active DECIMAL(3, 2) CHECK (vibe_active BETWEEN 0 AND 1) DEFAULT 0.5;

COMMENT ON COLUMN places.vibe_active IS 'Energy level: 0 = relaxing/low-energy, 1 = active/high-energy';

-- ============================================================
-- Add vibe_active column to events
-- ============================================================
ALTER TABLE events
ADD COLUMN vibe_active DECIMAL(3, 2) CHECK (vibe_active BETWEEN 0 AND 1) DEFAULT 0.5;

COMMENT ON COLUMN events.vibe_active IS 'Energy level: 0 = relaxing/low-energy, 1 = active/high-energy';

-- ============================================================
-- Update activities view to include vibe_active
-- ============================================================
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
  p.best_times,
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
  NULL::TEXT AS source
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
  NULL AS best_times,
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
  e.source
FROM events e
WHERE e.start_time > NOW() - INTERVAL '2 hours';

-- ============================================================
-- Set default vibe_active values for existing places
-- Based on existing low_energy and type heuristics
-- ============================================================

-- Very relaxing places (low energy)
UPDATE places
SET vibe_active = 0.2
WHERE low_energy = TRUE;

-- Active places (high energy, social)
UPDATE places
SET vibe_active = 0.8
WHERE vibe_quiet < 0.4 AND low_energy = FALSE;

-- Nature/walking places are moderate
UPDATE places
SET vibe_active = 0.6
WHERE type IN ('walk', 'nature', 'garden');

-- Cafes/bookstores are relaxing
UPDATE places
SET vibe_active = 0.3
WHERE type IN ('café', 'bookstore');

-- Bars/markets are more active
UPDATE places
SET vibe_active = 0.7
WHERE type IN ('bar', 'market');

-- ============================================================
-- Set default vibe_active values for existing events
-- ============================================================

-- Events are generally moderate to high energy (unless specified otherwise)
UPDATE events
SET vibe_active = CASE
  WHEN low_energy = TRUE THEN 0.3
  WHEN tags @> ARRAY['music', 'dance', 'sports', 'active'] THEN 0.8
  WHEN tags @> ARRAY['lecture', 'workshop', 'meditation'] THEN 0.4
  ELSE 0.6
END;
