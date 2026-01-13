-- Migration 002: Seed Madison places from MVP
-- Migrates the 8 hand-curated places from MADISON_PLACES array

-- Get Madison city_id (should be 1)
DO $$
DECLARE
  madison_city_id INTEGER;
BEGIN
  SELECT id INTO madison_city_id FROM cities WHERE slug = 'madison';

  -- Bradbury's Coffee
  INSERT INTO places (
    city_id, name, slug, type, neighborhood,
    vibe_quiet, vibe_inside,
    best_times, walk_minutes_from_center,
    story, nudge, tags,
    lat, lng, hours,
    kid_friendly, low_energy, price_level,
    is_active
  ) VALUES (
    madison_city_id,
    'Bradbury''s Coffee',
    'bradburys-coffee',
    'café',
    'Capitol Square',
    0.7, 0.9,
    ARRAY['morning', 'afternoon'],
    12,
    'Tucked into the capitol square''s northwest corner, Bradbury''s has that rare combination: excellent coffee, natural light, and tables spaced for actual solitude. The regulars read books here, not laptops.',
    'Order the cortado. Sit at the window facing the square. Bring something to read that isn''t on a screen.',
    ARRAY['walkable', 'quiet', 'solo-friendly'],
    43.0747, -89.3882,
    '{"general": "7am-6pm"}',
    FALSE, TRUE, 2,
    TRUE
  );

  -- Olbrich Botanical Gardens
  INSERT INTO places (
    city_id, name, slug, type, neighborhood,
    vibe_quiet, vibe_inside,
    best_times, walk_minutes_from_center,
    story, nudge, tags,
    lat, lng, hours,
    kid_friendly, low_energy, price_level,
    is_active
  ) VALUES (
    madison_city_id,
    'Olbrich Botanical Gardens',
    'olbrich-botanical-gardens',
    'garden',
    'East Side',
    0.8, 0.2,
    ARRAY['morning', 'afternoon'],
    25,
    'The Thai Pavilion catches most visitors, but the real magic is the rock garden path in late afternoon light. It''s designed for wandering without purpose—which is, of course, the purpose.',
    'Enter through the back parking lot. Turn left immediately. Walk slowly. The bench by the pond is worth sitting on for ten minutes.',
    ARRAY['walkable', 'outside', 'peaceful'],
    43.0894, -89.3334,
    '{"summer": "8am-8pm"}',
    TRUE, TRUE, 1,
    TRUE
  );

  -- The Weary Traveler
  INSERT INTO places (
    city_id, name, slug, type, neighborhood,
    vibe_quiet, vibe_inside,
    best_times, walk_minutes_from_center,
    story, nudge, tags,
    lat, lng, hours,
    kid_friendly, low_energy, price_level,
    is_active
  ) VALUES (
    madison_city_id,
    'The Weary Traveler',
    'the-weary-traveler',
    'bar',
    'Willy Street',
    0.3, 0.8,
    ARRAY['evening'],
    18,
    'Not a craft cocktail bar. Not trying to be. The Weary Traveler is where the east side goes to be comfortably social without performance. The patio is the move when weather permits.',
    'Go on a weeknight. Order whatever''s on tap. If the patio''s open, claim a corner table. Conversation happens naturally here.',
    ARRAY['social', 'casual', 'local'],
    43.0768, -89.3556,
    '{"general": "4pm-close"}',
    FALSE, FALSE, 2,
    TRUE
  );

  -- Tenney Park Lock & Dam
  INSERT INTO places (
    city_id, name, slug, type, neighborhood,
    vibe_quiet, vibe_inside,
    best_times, walk_minutes_from_center,
    story, nudge, tags,
    lat, lng, hours,
    kid_friendly, low_energy, price_level,
    is_active
  ) VALUES (
    madison_city_id,
    'Tenney Park Lock & Dam',
    'tenney-park-lock-dam',
    'walk',
    'Tenney-Lapham',
    0.6, 0.0,
    ARRAY['morning', 'evening'],
    20,
    'Most people walk past the lock and dam without stopping. Don''t. The water mechanics are oddly meditative, and on summer evenings you''ll catch kayakers waiting their turn while herons hunt the shallows.',
    'Walk the full loop around Tenney Park first (15 min), then end at the lock. Bring nothing. Watch the water.',
    ARRAY['outside', 'free', 'meditative'],
    43.0892, -89.3678,
    '{"general": "Always open"}',
    TRUE, TRUE, 1,
    TRUE
  );

  -- Mystery to Me
  INSERT INTO places (
    city_id, name, slug, type, neighborhood,
    vibe_quiet, vibe_inside,
    best_times, walk_minutes_from_center,
    story, nudge, tags,
    lat, lng, hours,
    kid_friendly, low_energy, price_level,
    is_active
  ) VALUES (
    madison_city_id,
    'Mystery to Me',
    'mystery-to-me',
    'bookstore',
    'Monroe Street',
    0.8, 0.9,
    ARRAY['afternoon'],
    22,
    'An independent bookstore that actually feels independent. The staff recommendations are genuine (and weird in the right ways). The mystery section is deep, but don''t sleep on their literary fiction picks.',
    'Ask whoever''s working what they just finished reading. Buy something you wouldn''t have found on your own. Walk to Colectivo after.',
    ARRAY['quiet', 'browsing', 'local'],
    43.0628, -89.4142,
    '{"general": "10am-7pm"}',
    TRUE, TRUE, 2,
    TRUE
  );

  -- Garver Feed Mill
  INSERT INTO places (
    city_id, name, slug, type, neighborhood,
    vibe_quiet, vibe_inside,
    best_times, walk_minutes_from_center,
    story, nudge, tags,
    lat, lng, hours,
    kid_friendly, low_energy, price_level,
    is_active
  ) VALUES (
    madison_city_id,
    'Garver Feed Mill',
    'garver-feed-mill',
    'market',
    'East Side',
    0.4, 0.6,
    ARRAY['morning', 'afternoon'],
    30,
    'A beautifully restored feed mill that now houses local food vendors and makers. Ian''s Pizza, Underground Food Collective, Ledger Coffee. It''s a destination that earns the walk.',
    'Saturday morning is busy but worth it. Get coffee from Ledger, browse the Dane County Farmers'' Market extension, then sit in the courtyard.',
    ARRAY['food', 'local', 'weekend'],
    43.0912, -89.3289,
    '{"general": "7am-9pm"}',
    TRUE, FALSE, 2,
    TRUE
  );

  -- Picnic Point
  INSERT INTO places (
    city_id, name, slug, type, neighborhood,
    vibe_quiet, vibe_inside,
    best_times, walk_minutes_from_center,
    story, nudge, tags,
    lat, lng, hours,
    kid_friendly, low_energy, price_level,
    is_active
  ) VALUES (
    madison_city_id,
    'Picnic Point',
    'picnic-point',
    'nature',
    'UW Campus',
    0.9, 0.0,
    ARRAY['morning', 'evening'],
    35,
    'A narrow peninsula stretching into Lake Mendota. The walk out and back is exactly long enough to process something you''ve been avoiding thinking about. Sunset from the point is Madison''s best free show.',
    'Go alone. Leave your phone in your pocket until you reach the tip. On the way back, you''ll know what you needed to figure out.',
    ARRAY['nature', 'solo', 'meditative'],
    43.0858, -89.4275,
    '{"general": "4am-11pm"}',
    TRUE, FALSE, 1,
    TRUE
  );

  -- Daisy Cafe & Cupcakery
  INSERT INTO places (
    city_id, name, slug, type, neighborhood,
    vibe_quiet, vibe_inside,
    best_times, walk_minutes_from_center,
    story, nudge, tags,
    lat, lng, hours,
    kid_friendly, low_energy, price_level,
    is_active
  ) VALUES (
    madison_city_id,
    'Daisy Cafe & Cupcakery',
    'daisy-cafe-cupcakery',
    'café',
    'Atwood',
    0.5, 0.7,
    ARRAY['morning', 'afternoon'],
    15,
    'Brunch with personality. The space is small and a little loud, which somehow makes it feel more alive. The cupcakes are what they''re known for, but the savory menu is the real draw.',
    'Weekday breakfast avoids the weekend wait. Get the Atwood scramble. Take a cupcake to go for later.',
    ARRAY['food', 'local', 'casual'],
    43.0891, -89.3456,
    '{"general": "7am-3pm"}',
    TRUE, TRUE, 2,
    TRUE
  );

END $$;

-- Verify insertion
SELECT
  id,
  name,
  type,
  neighborhood,
  vibe_quiet,
  vibe_inside,
  kid_friendly,
  low_energy
FROM places
ORDER BY id;
