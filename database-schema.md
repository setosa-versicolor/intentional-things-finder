# Database Schema Design - Intentional Things Finder

## Architecture Decision: Hybrid PostgreSQL + pgvector

### Rationale
- **Structured filtering** for date/time/location/constraints (PostgreSQL native)
- **Semantic similarity** for vibe/description matching (pgvector)
- **Cost-effective** at scale vs. pure vector DBs
- **Easier debugging** and explainability for recommendations

---

## Core Tables

### 1. `cities`
Supports multi-city expansion.

```sql
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

-- Madison entry
INSERT INTO cities (name, slug, state, timezone, center_lat, center_lng)
VALUES ('Madison', 'madison', 'WI', 'America/Chicago', 43.0731, -89.4012);
```

---

### 2. `places`
Evergreen locations (cafes, parks, bookstores) - your current 8 places.

```sql
CREATE TABLE places (
  id SERIAL PRIMARY KEY,
  city_id INTEGER REFERENCES cities(id),

  -- Basic info
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL, -- café, bar, garden, walk, bookstore, market, nature
  neighborhood VARCHAR(100),

  -- Location
  address TEXT,
  lat DECIMAL(10, 8),
  lng DECIMAL(11, 8),
  walk_minutes_from_center INTEGER, -- from city center

  -- Vibe scores (0-1 scale)
  vibe_quiet DECIMAL(3, 2) CHECK (vibe_quiet BETWEEN 0 AND 1),
  vibe_inside DECIMAL(3, 2) CHECK (vibe_inside BETWEEN 0 AND 1),

  -- Descriptions
  story TEXT, -- narrative (what makes it special)
  nudge TEXT, -- prescriptive instructions

  -- Operational
  hours JSONB, -- {"monday": "8am-5pm", ...}
  best_times TEXT[], -- array: ['morning', 'afternoon', 'evening']

  -- Constraints
  kid_friendly BOOLEAN DEFAULT FALSE,
  low_energy BOOLEAN DEFAULT FALSE,
  wheelchair_accessible BOOLEAN DEFAULT NULL,
  price_level INTEGER CHECK (price_level BETWEEN 1 AND 4), -- $ to $$$$

  -- Metadata
  tags TEXT[], -- searchable array
  website VARCHAR(500),
  phone VARCHAR(20),

  -- Vector embedding for semantic search
  embedding vector(1536), -- OpenAI ada-002 dimensions

  -- Housekeeping
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(city_id, slug)
);

CREATE INDEX idx_places_city ON places(city_id);
CREATE INDEX idx_places_type ON places(type);
CREATE INDEX idx_places_tags ON places USING GIN(tags);
CREATE INDEX idx_places_location ON places USING GIST(ll_to_earth(lat, lng));
CREATE INDEX idx_places_embedding ON places USING ivfflat(embedding vector_cosine_ops);
```

---

### 3. `events`
Time-bound happenings (concerts, markets, lectures) - scraped data.

```sql
CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  city_id INTEGER REFERENCES cities(id),
  place_id INTEGER REFERENCES places(id) NULL, -- link to venue if it's a known place

  -- Basic info
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(500) NOT NULL,
  description TEXT,

  -- Time
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  is_recurring BOOLEAN DEFAULT FALSE,
  recurrence_rule TEXT, -- iCal RRULE format if recurring

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
  primary_category VARCHAR(100), -- Music, Art, Food, etc.
  categories TEXT[], -- multiple categories
  tags TEXT[],

  -- Constraints
  kid_friendly BOOLEAN DEFAULT NULL,
  low_energy BOOLEAN DEFAULT NULL,
  wheelchair_accessible BOOLEAN DEFAULT NULL,

  -- Pricing
  is_free BOOLEAN DEFAULT FALSE,
  price_min DECIMAL(10, 2),
  price_max DECIMAL(10, 2),
  price_description VARCHAR(255), -- "$10-$15" or "Free with registration"

  -- Links
  website VARCHAR(500),
  rsvp_link VARCHAR(500),
  ticket_link VARCHAR(500),
  image_url VARCHAR(500),

  -- Source tracking
  source VARCHAR(50) NOT NULL, -- 'isthmus', '608today', 'manual'
  source_id VARCHAR(255), -- external ID from source
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

CREATE INDEX idx_events_city ON events(city_id);
CREATE INDEX idx_events_place ON events(place_id);
CREATE INDEX idx_events_time ON events(start_time, end_time);
CREATE INDEX idx_events_categories ON events USING GIN(categories);
CREATE INDEX idx_events_tags ON events USING GIN(tags);
CREATE INDEX idx_events_source ON events(source, source_id);
CREATE INDEX idx_events_active_upcoming ON events(is_active, start_time)
  WHERE is_active = TRUE AND start_time > NOW();
CREATE INDEX idx_events_embedding ON events USING ivfflat(embedding vector_cosine_ops);
```

---

### 4. `recommendations`
Log user queries and results for learning.

```sql
CREATE TABLE recommendations (
  id SERIAL PRIMARY KEY,
  city_id INTEGER REFERENCES cities(id),

  -- User preferences (from input screen)
  time_available INTEGER, -- minutes
  quiet_social DECIMAL(3, 2), -- 0-1 scale
  inside_outside DECIMAL(3, 2), -- 0-1 scale
  kid_friendly BOOLEAN,
  low_energy BOOLEAN,

  -- Context
  requested_at TIMESTAMPTZ NOT NULL,
  time_of_day VARCHAR(20), -- 'morning', 'afternoon', 'evening'
  day_of_week VARCHAR(20),

  -- Results (JSONB for flexibility)
  results JSONB, -- [{place_id: 1, score: 85, rank: 1}, ...]

  -- Feedback (for future learning)
  selected_id INTEGER, -- which result did they choose?
  selected_type VARCHAR(20), -- 'place' or 'event'
  feedback_rating INTEGER CHECK (feedback_rating BETWEEN 1 AND 5),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recommendations_city ON recommendations(city_id);
CREATE INDEX idx_recommendations_time ON recommendations(requested_at);
```

---

### 5. `scraped_events_raw`
Staging table for deduplication and quality control.

```sql
CREATE TABLE scraped_events_raw (
  id SERIAL PRIMARY KEY,
  source VARCHAR(50) NOT NULL,
  source_id VARCHAR(255),
  raw_data JSONB NOT NULL, -- full scraped JSON
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  event_id INTEGER REFERENCES events(id), -- after processing

  UNIQUE(source, source_id, scraped_at)
);

CREATE INDEX idx_scraped_raw_unprocessed ON scraped_events_raw(processed, scraped_at)
  WHERE processed = FALSE;
```

---

## Unified Data Model

### Combined `activity` view
For the recommendation engine to query both places and events.

```sql
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
  p.is_active
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
  NULL AS walk_minutes_from_center, -- compute dynamically
  e.start_time,
  e.end_time,
  e.embedding,
  e.is_active
FROM events e
WHERE e.start_time > NOW() - INTERVAL '2 hours'; -- exclude past events
```

---

## Data Normalization Rules

### Isthmus Event Mapping
```json
{
  "title": "event.title",
  "description": "event.description",
  "start_time": "event.dtstart (ISO 8601)",
  "end_time": "event.dtend",
  "venue_name": "event.location.name",
  "venue_address": "event.location.address",
  "lat": "event.location.latitude",
  "lng": "event.location.longitude",
  "categories": "event.categories (map to our taxonomy)",
  "is_free": "parse from event.price",
  "price_description": "event.price",
  "source": "'isthmus'",
  "source_id": "event.uuid",
  "source_url": "https://isthmus.com/events/{slug}/?occ_dtstart={timestamp}",
  "image_url": "event.image.url",
  "website": "event.website"
}
```

### 608today Event Mapping
```json
{
  "title": "article.headline",
  "description": "article.excerpt",
  "start_time": "parse from article.publicationDate or body",
  "categories": "article.category",
  "source": "'608today'",
  "source_url": "article.url",
  "image_url": "article.featuredImage.url"
}
```
**Note:** 608today appears to be article-based, not structured events. May need to:
1. Parse event details from article body
2. Use as supplementary/curated content
3. Treat as "editorial picks" rather than comprehensive calendar

---

## Vector Embedding Strategy

### What to Embed
1. **Places:** `story + nudge + tags` (captures vibe and purpose)
2. **Events:** `title + description + categories` (captures content)

### When to Embed
- On insert/update via trigger or application layer
- Use OpenAI `text-embedding-3-small` (1536 dimensions, $0.02/1M tokens)

### Example Embedding Trigger
```sql
CREATE OR REPLACE FUNCTION update_place_embedding()
RETURNS TRIGGER AS $$
BEGIN
  -- Call embedding API via application layer (not in trigger)
  -- This is a placeholder; actual implementation via API
  RAISE NOTICE 'Embedding update needed for place %', NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER place_embedding_trigger
AFTER INSERT OR UPDATE OF story, nudge, tags ON places
FOR EACH ROW EXECUTE FUNCTION update_place_embedding();
```

---

## Search Query Strategy

### 1. Hard Filters (PostgreSQL WHERE clauses)
```sql
WHERE
  city_id = $1
  AND is_active = TRUE
  AND (
    (type = 'place') OR
    (type = 'event' AND start_time BETWEEN $time_range_start AND $time_range_end)
  )
  AND ($kid_friendly = FALSE OR kid_friendly = TRUE)
  AND walk_minutes_from_center <= ($time_available / 2) -- round trip
```

### 2. Vibe Scoring (Application Layer)
```javascript
const vibeScore = (activity, prefs) => {
  const quietMatch = 1 - Math.abs(activity.vibe_quiet - prefs.quietSocial);
  const insideMatch = 1 - Math.abs(activity.vibe_inside - prefs.insideOutside);
  return (quietMatch * 30) + (insideMatch * 30);
};
```

### 3. Semantic Search (pgvector)
Only when user provides text query:
```sql
SELECT *, (embedding <=> $query_embedding) AS similarity
FROM activities
WHERE ... [hard filters]
ORDER BY embedding <=> $query_embedding
LIMIT 20;
```

### 4. Combined Scoring
```javascript
finalScore =
  vibeScore * 0.5 +
  semanticScore * 0.3 +
  timeOfDayBonus * 0.1 +
  randomness * 0.1;
```

---

## Next Steps

1. **Create migration files** (PostgreSQL schema)
2. **Build scrapers** for Isthmus and 608today
3. **ETL pipeline** to normalize into unified schema
4. **Embedding generation** service
5. **API endpoints** for search/recommendations
6. **Migrate existing 8 places** into database

---

## Tech Stack Recommendation

- **Database:** PostgreSQL 15+ with pgvector extension
- **Backend:** Node.js + Express (or Fastify)
- **ORM:** Prisma or Drizzle (TypeScript support)
- **Scraping:** Puppeteer or Cheerio
- **Embeddings:** OpenAI API (text-embedding-3-small)
- **Hosting:**
  - DB: Supabase (free tier includes pgvector) or Railway
  - API: Vercel/Railway/Render
  - Scrapers: GitHub Actions (scheduled) or Render cron jobs
