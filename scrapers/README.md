# Event Scrapers for Intentional Things Finder

This directory contains web scrapers and ETL pipelines for building a tagged, searchable database of events and places in Madison, WI.

## Overview

The scraping infrastructure consists of:

1. **Isthmus Scraper** - Extracts structured events from isthmus.com calendar
2. **608today Scraper** - Extracts event articles from 608today.6amcity.com
3. **Embedding Generator** - Creates vector embeddings for semantic search
4. **Database Schema** - PostgreSQL with pgvector for hybrid search

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│ Isthmus.com     │────▶│ Raw Events      │
│ Calendar        │     │ (JSON staging)  │
└─────────────────┘     └────────┬────────┘
                                 │
┌─────────────────┐              │
│ 608today        │──────────────┤
│ Articles        │              │
└─────────────────┘              ▼
                        ┌─────────────────┐
                        │ Normalized      │
                        │ Events Table    │
                        └────────┬────────┘
                                 │
                        ┌────────▼────────┐
                        │ OpenAI          │
                        │ Embeddings      │
                        └────────┬────────┘
                                 │
                        ┌────────▼────────┐
                        │ Activities View │
                        │ (Places+Events) │
                        └─────────────────┘
```

## Setup

### 1. Install Dependencies

```bash
cd scrapers
npm install
```

### 2. Set Up Database

Create a PostgreSQL database with pgvector extension:

```bash
createdb intentional_things

# Connect and enable extensions
psql intentional_things -c "CREATE EXTENSION vector;"
```

Run migrations:

```bash
psql intentional_things < ../migrations/001_initial_schema.sql
psql intentional_things < ../migrations/002_seed_madison_places.sql
```

### 3. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:
```
DATABASE_URL=postgresql://user:password@localhost:5432/intentional_things
OPENAI_API_KEY=sk-...your-key-here
```

## Usage

### Run Scrapers

Scrape Isthmus events (5 pages):
```bash
npm run scrape:isthmus
```

Scrape 608today articles:
```bash
npm run scrape:608today
```

Run both scrapers:
```bash
npm run scrape:all
```

### Generate Embeddings

After scraping, generate vector embeddings for semantic search:

```bash
node generate-embeddings.js
```

This will:
1. Generate embeddings for all places (story + nudge + tags)
2. Generate embeddings for all events (title + description + categories)
3. Create vector indexes for efficient similarity search

**Note:** This uses OpenAI API and will incur costs (~$0.02 per 1M tokens with text-embedding-3-small).

## Data Flow

### Isthmus Scraper

1. Uses Puppeteer to scrape calendar pages
2. Extracts JSON-LD structured data
3. Merges with scraped HTML data
4. Normalizes into unified schema
5. Stores in `scraped_events_raw` (staging)
6. Processes into `events` table

**Key Features:**
- Extracts 42+ event categories
- Parses location coordinates
- Infers vibe scores from categories
- Handles pricing information
- Respects rate limiting (2s between pages)

### 608today Scraper

1. Scrapes event-related articles
2. Parses event details from article text
3. Extracts dates, times, locations using regex
4. Stores as editorial/curated events

**Note:** This source is article-based, so event data may be less structured than Isthmus.

### Embedding Generation

1. Combines relevant text fields per activity
2. Calls OpenAI API to generate 1536-dimension vectors
3. Updates database with embeddings
4. Creates IVFFlat indexes (if ≥100 records) or HNSW

**Cost Estimate:**
- 8 places × 500 tokens = 4,000 tokens
- 100 events × 300 tokens = 30,000 tokens
- Total: ~34,000 tokens = $0.0007 per run

## Database Schema

### Key Tables

- **`cities`** - City metadata (Madison, future cities)
- **`places`** - Evergreen locations (cafes, parks, venues)
- **`events`** - Time-bound happenings (concerts, markets)
- **`scraped_events_raw`** - Staging table for raw scraped data
- **`recommendations`** - User query log for learning
- **`activities`** (view) - Unified places + events

### Vibe Inference

Events are automatically tagged with vibe scores (0-1 scale):

**Quiet/Social (vibe_quiet):**
- Music, Dancing, Sports → 0.2 (social)
- Art, Lectures, Film → 0.7 (quiet)

**Inside/Outside (vibe_inside):**
- Outdoors, Nature, Sports → 0.2 (outside)
- Theater, Film, Lectures → 0.9 (inside)

## Scheduling Scrapers

### GitHub Actions (Recommended)

Create `.github/workflows/scrape-events.yml`:

```yaml
name: Scrape Events
on:
  schedule:
    - cron: '0 6 * * *'  # Daily at 6am UTC
  workflow_dispatch:

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      - run: npm install
        working-directory: scrapers
      - run: npm run scrape:all
        working-directory: scrapers
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
      - run: node generate-embeddings.js
        working-directory: scrapers
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### Cron Job (Self-hosted)

```bash
# Add to crontab
0 6 * * * cd /path/to/intentional-things-finder_v2/scrapers && npm run scrape:all && node generate-embeddings.js
```

## Monitoring

Check scraper status:

```sql
-- Raw events by source
SELECT source, COUNT(*), MAX(scraped_at) as last_scraped
FROM scraped_events_raw
GROUP BY source;

-- Processed events
SELECT source, COUNT(*), MAX(start_time) as latest_event
FROM events
WHERE is_active = TRUE
GROUP BY source;

-- Embedding coverage
SELECT
  COUNT(*) as total,
  COUNT(embedding) as with_embeddings,
  ROUND(100.0 * COUNT(embedding) / COUNT(*), 2) as coverage_pct
FROM activities;
```

## Troubleshooting

### Puppeteer Errors

If Puppeteer fails to launch:
```bash
# Install Chromium dependencies (Ubuntu)
sudo apt-get install -y gconf-service libasound2 libatk1.0-0 libcups2 libdbus-1-3 \
  libgconf-2-4 libgtk-3-0 libnspr4 libnss3 libx11-xcb1 libxss1 libxtst6
```

### Database Connection Errors

Verify connection string:
```bash
psql "$DATABASE_URL" -c "SELECT version();"
```

### Rate Limiting

If OpenAI rate limits are hit:
- Adjust `REQUESTS_PER_MINUTE` in `generate-embeddings.js`
- Consider batching embeddings
- Use lower tier model if needed

## Next Steps

1. **Expand Sources** - Add more event calendars (Madisonbubbler, DoStuff, etc.)
2. **Improve Parsing** - Use LLMs to extract structured data from unstructured text
3. **Quality Checks** - Add validation for duplicate events, bad data
4. **Monitoring** - Set up alerts for scraper failures
5. **Multi-city** - Replicate for other cities

## Files

- `isthmus-scraper.js` - Isthmus calendar scraper
- `608today-scraper.js` - 608today article scraper
- `generate-embeddings.js` - Vector embedding generator
- `package.json` - Dependencies and scripts
- `.env.example` - Environment variable template
- `README.md` - This file
