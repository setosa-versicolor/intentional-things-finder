-- Intentional Things Finder - Initial Schema
-- Migration 001: Core tables for cities, places, events

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- ============================================================
-- TABLE: cities
-- ============================================================
CREATE TABLE cities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  state VARCHAR(2) NOT NULL,
  country VARCHAR(2) DEFAULT 'US',
  timezone VARCHAR(50) NOT NULL,
  center_lat DECIMAL(10, 8) NOT NULL,
  center_lng DECIMAL(11, 8) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Madison
INSERT INTO cities (name, slug, state, timezone, center_lat, center_lng)
VALUES ('Madison', 'madison', 'WI', 'America/Chicago', 43.0731, -89.4012);

-- ============================================================
-- TABLE: places
-- ============================================================
CREATE TABLE places (
  id SERIAL PRIMARY KEY,
  city_id INTEGER REFERENCES cities(id) ON DELETE CASCADE,

  -- Basic info
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL, -- café, bar, garden, walk, bookstore, market, nature
  neighborhood VARCHAR(100),

  -- Location
  address TEXT,
  lat DECIMAL(10, 8),
  lng DECIMAL(11, 8),
  walk_minutes_from_center INTEGER,

  -- Vibe scores (0-1 scale)
  vibe_quiet DECIMAL(3, 2) CHECK (vibe_quiet BETWEEN 0 AND 1),
  vibe_inside DECIMAL(3, 2) CHECK (vibe_inside BETWEEN 0 AND 1),

  -- Descriptions
  story TEXT,
  nudge TEXT,

  -- Operational
  hours JSONB,
  best_times TEXT[],

  -- Constraints
  kid_friendly BOOLEAN DEFAULT FALSE,
  low_energy BOOLEAN DEFAULT FALSE,
  wheelchair_accessible BOOLEAN DEFAULT NULL,
  price_level INTEGER CHECK (price_level BETWEEN 1 AND 4),

  -- Metadata
  tags TEXT[],
  website VARCHAR(500),
  phone VARCHAR(20),

  -- Vector embedding (1536 dimensions for OpenAI text-embedding-3-small)
  embedding vector(1536),

  -- Housekeeping
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(city_id, slug)
);

-- Indexes for places
CREATE INDEX idx_places_city ON places(city_id);
CREATE INDEX idx_places_type ON places(type);
CREATE INDEX idx_places_tags ON places USING GIN(tags);
CREATE INDEX idx_places_active ON places(is_active) WHERE is_active = TRUE;
-- Vector index using IVFFlat (requires training data, add after populating)
-- CREATE INDEX idx_places_embedding ON places USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================
-- TABLE: events
-- ============================================================
CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  city_id INTEGER REFERENCES cities(id) ON DELETE CASCADE,
  place_id INTEGER REFERENCES places(id) ON DELETE SET NULL,

  -- Basic info
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(500) NOT NULL,
  description TEXT,

  -- Time
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  is_recurring BOOLEAN DEFAULT FALSE,
  recurrence_rule TEXT,

  -- Location (if not linked to place)
  venue_name VARCHAR(255),
  venue_address TEXT,
  lat DECIMAL(10, 8),
  lng DECIMAL(11, 8),
  neighborhood VARCHAR(100),

  -- Vibe scores (computed or manually tagged)
  vibe_quiet DECIMAL(3, 2) CHECK (vibe_quiet BETWEEN 0 AND 1),
  vibe_inside DECIMAL(3, 2) CHECK (vibe_inside BETWEEN 0 AND 1),

  -- Categorization
  primary_category VARCHAR(100),
  categories TEXT[],
  tags TEXT[],

  -- Constraints
  kid_friendly BOOLEAN DEFAULT NULL,
  low_energy BOOLEAN DEFAULT NULL,
  wheelchair_accessible BOOLEAN DEFAULT NULL,

  -- Pricing
  is_free BOOLEAN DEFAULT FALSE,
  price_min DECIMAL(10, 2),
  price_max DECIMAL(10, 2),
  price_description VARCHAR(255),

  -- Links
  website VARCHAR(500),
  rsvp_link VARCHAR(500),
  ticket_link VARCHAR(500),
  image_url VARCHAR(500),

  -- Source tracking
  source VARCHAR(50) NOT NULL,
  source_id VARCHAR(255),
  source_url VARCHAR(500),

  -- Vector embedding
  embedding vector(1536),

  -- Housekeeping
  is_active BOOLEAN DEFAULT TRUE,
  scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(source, source_id)
);

-- Indexes for events
CREATE INDEX idx_events_city ON events(city_id);
CREATE INDEX idx_events_place ON events(place_id);
CREATE INDEX idx_events_time ON events(start_time, end_time);
CREATE INDEX idx_events_categories ON events USING GIN(categories);
CREATE INDEX idx_events_tags ON events USING GIN(tags);
CREATE INDEX idx_events_source ON events(source, source_id);
CREATE INDEX idx_events_active_upcoming ON events(is_active, start_time)
  WHERE is_active = TRUE;
-- Vector index (add after populating)
-- CREATE INDEX idx_events_embedding ON events USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================
-- TABLE: recommendations
-- ============================================================
CREATE TABLE recommendations (
  id SERIAL PRIMARY KEY,
  city_id INTEGER REFERENCES cities(id) ON DELETE CASCADE,

  -- User preferences
  time_available INTEGER,
  quiet_social DECIMAL(3, 2),
  inside_outside DECIMAL(3, 2),
  kid_friendly BOOLEAN,
  low_energy BOOLEAN,

  -- Context
  requested_at TIMESTAMPTZ NOT NULL,
  time_of_day VARCHAR(20),
  day_of_week VARCHAR(20),

  -- Results
  results JSONB,

  -- Feedback
  selected_id INTEGER,
  selected_type VARCHAR(20),
  feedback_rating INTEGER CHECK (feedback_rating BETWEEN 1 AND 5),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recommendations_city ON recommendations(city_id);
CREATE INDEX idx_recommendations_time ON recommendations(requested_at);

-- ============================================================
-- TABLE: scraped_events_raw
-- ============================================================
CREATE TABLE scraped_events_raw (
  id SERIAL PRIMARY KEY,
  source VARCHAR(50) NOT NULL,
  source_id VARCHAR(255),
  raw_data JSONB NOT NULL,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,

  UNIQUE(source, source_id, scraped_at)
);

CREATE INDEX idx_scraped_raw_unprocessed ON scraped_events_raw(processed, scraped_at)
  WHERE processed = FALSE;

-- ============================================================
-- VIEW: activities (unified places + events)
-- ============================================================
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
-- FUNCTIONS: Update timestamps
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_places_updated_at
BEFORE UPDATE ON places
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_events_updated_at
BEFORE UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- COMMENTS
-- ============================================================
COMMENT ON TABLE cities IS 'Cities supported by the app';
COMMENT ON TABLE places IS 'Evergreen locations (cafes, parks, venues)';
COMMENT ON TABLE events IS 'Time-bound happenings (concerts, markets, festivals)';
COMMENT ON TABLE recommendations IS 'User query log for learning';
COMMENT ON TABLE scraped_events_raw IS 'Raw scraped data staging area';
COMMENT ON VIEW activities IS 'Unified view of places and events for recommendations';
