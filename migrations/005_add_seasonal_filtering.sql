-- Migration 005: Add seasonal filtering support
-- Adds seasons field to track when places are best/available

-- Add seasons array to places
ALTER TABLE places
ADD COLUMN seasons TEXT[] DEFAULT NULL;

-- Add comment explaining the field
COMMENT ON COLUMN places.seasons IS 'Array of seasons when this place is available/best: spring, summer, fall, winter. NULL means available year-round.';

-- Create index for seasonal filtering
CREATE INDEX idx_places_seasons ON places USING GIN(seasons);

-- Update places with known seasonal restrictions
-- Pope Farm Conservancy - best in summer/fall
UPDATE places
SET seasons = ARRAY['summer', 'fall']
WHERE name ILIKE '%pope farm%';

-- Beaches - summer only
UPDATE places
SET seasons = ARRAY['summer']
WHERE type IN ('beach', 'swimming-area');

-- Any place with "summer" or "seasonal" in nudge/story should be flagged
-- (This is a conservative approach - we can refine later with manual review)
UPDATE places
SET seasons = ARRAY['summer']
WHERE (
  (story ILIKE '%summer only%' OR nudge ILIKE '%summer only%')
  OR (story ILIKE '%seasonal%' AND story ILIKE '%summer%')
  OR (story ILIKE '%late summer%' AND story NOT ILIKE '%year%round%')
)
AND seasons IS NULL;

-- Places with winter-specific activities
UPDATE places
SET seasons = ARRAY['winter']
WHERE (
  story ILIKE '%ice skating%'
  OR story ILIKE '%cross-country ski%'
  OR story ILIKE '%snow%'
  OR tags && ARRAY['ice-skating', 'skiing', 'winter-sports']
)
AND seasons IS NULL;

-- Display what was updated
SELECT
  name,
  type,
  seasons,
  SUBSTRING(story FROM 1 FOR 100) as story_snippet
FROM places
WHERE seasons IS NOT NULL
ORDER BY name;
