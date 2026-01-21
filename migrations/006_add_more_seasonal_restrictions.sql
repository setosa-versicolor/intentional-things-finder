-- Migration 006: Add more seasonal restrictions (refined)
-- Only marking places as seasonal if they're ONLY available during specific seasons,
-- not just "better" in those seasons

-- =================================================================
-- WINTER ONLY - Places that are genuinely unavailable outside winter
-- =================================================================

-- Sledding hills (only usable when there's snow)
UPDATE places SET seasons = ARRAY['winter'] WHERE id = 292; -- Elver Park Sledding Hill
UPDATE places SET seasons = ARRAY['winter'] WHERE id = 296; -- Olbrich Park Sledding Hill

-- Ice skating (needs frozen water)
UPDATE places SET seasons = ARRAY['winter'] WHERE id = 295; -- The Icehouse at Edgewater
UPDATE places SET seasons = ARRAY['winter'] WHERE id = 294; -- Vilas Park Ice Skating

-- =================================================================
-- SUMMER ONLY - Places only available in warm weather
-- =================================================================

-- Water activities (can't do when water is frozen)
UPDATE places SET seasons = ARRAY['summer'] WHERE id = 298; -- Brittingham Boats (kayak/paddling)
UPDATE places SET seasons = ARRAY['summer'] WHERE id = 299; -- Memorial Union Terrace Paddling
UPDATE places SET seasons = ARRAY['summer'] WHERE id = 297; -- Wingra Boats

-- Beach/water parks
UPDATE places SET seasons = ARRAY['summer'] WHERE id = 187; -- Brittingham Park (beach access)
UPDATE places SET seasons = ARRAY['summer'] WHERE id = 182; -- Henry Vilas Park (sandy beach)

-- =================================================================
-- SUMMER/FALL - Available in warm months
-- =================================================================

-- Long distance trails (better spring through fall, but let's be conservative)
UPDATE places SET seasons = ARRAY['spring', 'summer', 'fall'] WHERE id = 301; -- Badger State Trail
UPDATE places SET seasons = ARRAY['spring', 'summer', 'fall'] WHERE id = 303; -- Lake Monona Loop
UPDATE places SET seasons = ARRAY['spring', 'summer', 'fall'] WHERE id = 300; -- Military Ridge State Trail
UPDATE places SET seasons = ARRAY['spring', 'summer', 'fall'] WHERE id = 192; -- Capital City State Trail

-- Parks/trails best without snow/ice
UPDATE places SET seasons = ARRAY['spring', 'summer', 'fall'] WHERE id = 194; -- Lower Yahara River Trail
UPDATE places SET seasons = ARRAY['spring', 'summer', 'fall'] WHERE id = 191; -- UW Arboretum
UPDATE places SET seasons = ARRAY['spring', 'summer', 'fall'] WHERE id = 197; -- Ice Age Trail Segments
UPDATE places SET seasons = ARRAY['spring', 'summer', 'fall'] WHERE id = 198; -- Devil's Lake State Park
UPDATE places SET seasons = ARRAY['spring', 'summer', 'fall'] WHERE id = 199; -- Governor Dodge State Park

-- Comment on places we're NOT making seasonal:
-- - Restaurants/bars with patios: available year-round, just nicer in summer
-- - Coffee shops: year-round, even if they mention summer drinks
-- - Breweries with outdoor spaces: indoor options make them year-round
-- - Parks without specific seasonal features: usable year-round

-- Display what was updated
SELECT
  name,
  type,
  seasons,
  SUBSTRING(story FROM 1 FOR 80) as story_snippet
FROM places
WHERE seasons IS NOT NULL
ORDER BY
  CASE
    WHEN 'winter' = ANY(seasons) AND array_length(seasons, 1) = 1 THEN 1
    WHEN 'summer' = ANY(seasons) AND array_length(seasons, 1) = 1 THEN 2
    ELSE 3
  END,
  name;
