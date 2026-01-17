-- Migration 004: Update existing places with new tags
-- Maps old tags to new tag system

-- Bradbury's Coffee
UPDATE places
SET tags = ARRAY['solo-friendly', 'food-focused', 'cheap-eats', 'free']
WHERE slug = 'bradburys-coffee';

-- Olbrich Botanical Gardens
UPDATE places
SET tags = ARRAY['nature', 'kid-friendly', 'free', 'outside-my-norm']
WHERE slug = 'olbrich-botanical-gardens';

-- The Weary Traveler
UPDATE places
SET tags = ARRAY['friend-hangout', 'food-focused', 'date-night', 'cheap-eats']
WHERE slug = 'the-weary-traveler';

-- Tenney Park Lock & Dam
UPDATE places
SET tags = ARRAY['nature', 'free', 'kid-friendly', 'solo-friendly']
WHERE slug = 'tenney-park-lock-dam';

-- Mystery to Me
UPDATE places
SET tags = ARRAY['solo-friendly', 'unusual-options', 'outside-my-norm', 'creative']
WHERE slug = 'mystery-to-me';

-- Garver Feed Mill
UPDATE places
SET tags = ARRAY['food-focused', 'kid-friendly', 'friend-hangout', 'outside-my-norm']
WHERE slug = 'garver-feed-mill';

-- Picnic Point
UPDATE places
SET tags = ARRAY['nature', 'solo-friendly', 'free', 'kid-friendly']
WHERE slug = 'picnic-point';

-- Daisy Cafe & Cupcakery
UPDATE places
SET tags = ARRAY['food-focused', 'kid-friendly', 'friend-hangout', 'cheap-eats']
WHERE slug = 'daisy-cafe-cupcakery';
