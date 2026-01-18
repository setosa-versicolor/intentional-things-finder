-- Migration 002: Add Google Places API integration
-- Adds google_place_id and last_synced_at for automatic hours updates

ALTER TABLE places
ADD COLUMN google_place_id VARCHAR(255) UNIQUE,
ADD COLUMN last_synced_at TIMESTAMPTZ,
ADD COLUMN google_rating DECIMAL(2, 1),
ADD COLUMN google_user_ratings_total INTEGER;

CREATE INDEX idx_places_google_place_id ON places(google_place_id) WHERE google_place_id IS NOT NULL;
CREATE INDEX idx_places_last_synced ON places(last_synced_at) WHERE last_synced_at IS NOT NULL;

COMMENT ON COLUMN places.google_place_id IS 'Google Places API Place ID for fetching hours and details';
COMMENT ON COLUMN places.last_synced_at IS 'Last time we synced data from Google Places API';
COMMENT ON COLUMN places.google_rating IS 'Google Maps rating (1-5 scale)';
COMMENT ON COLUMN places.google_user_ratings_total IS 'Number of Google reviews';
