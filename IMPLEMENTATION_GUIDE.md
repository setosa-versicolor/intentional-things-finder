# Implementation Guide - Intentional Things Finder Database

This guide walks you through setting up the complete tagged database system for your app, from database setup to connecting it to your React frontend.

## Overview

You now have a **hybrid search architecture** that combines:
- **Structured filtering** (time, location, constraints) via PostgreSQL
- **Semantic similarity** (vibe matching) via pgvector embeddings
- **Weighted scoring** (your existing algorithm + new data)

## Quick Start (TL;DR)

```bash
# 1. Set up database
createdb intentional_things
psql intentional_things < migrations/001_initial_schema.sql
psql intentional_things < migrations/002_seed_madison_places.sql

# 2. Install scraper dependencies
cd scrapers
npm install
cp .env.example .env
# Edit .env with your DATABASE_URL and OPENAI_API_KEY

# 3. Scrape events
npm run scrape:all

# 4. Generate embeddings (optional but recommended)
node generate-embeddings.js

# 5. Start API
cd ../api
npm install
npm start

# 6. Update React app to use API (see Integration section)
```

---

## Part 1: Database Setup

### 1.1 Install PostgreSQL

**Mac (Homebrew):**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Ubuntu/Debian:**
```bash
sudo apt-get install postgresql-15 postgresql-contrib-15
sudo systemctl start postgresql
```

**Windows:**
Download from [postgresql.org](https://www.postgresql.org/download/windows/)

### 1.2 Install pgvector Extension

```bash
# Mac
brew install pgvector

# Ubuntu
sudo apt-get install postgresql-15-pgvector

# Or from source
git clone https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install
```

### 1.3 Create Database

```bash
# Create database
createdb intentional_things

# Enable extensions
psql intentional_things -c "CREATE EXTENSION vector;"
psql intentional_things -c "CREATE EXTENSION cube;"
psql intentional_things -c "CREATE EXTENSION earthdistance;"
```

### 1.4 Run Migrations

```bash
# From project root
psql intentional_things < migrations/001_initial_schema.sql
psql intentional_things < migrations/002_seed_madison_places.sql
```

Verify:
```bash
psql intentional_things -c "SELECT name, type FROM places;"
```

You should see your 8 curated Madison places.

---

## Part 2: Scraping Events

### 2.1 Configure Environment

```bash
cd scrapers
cp .env.example .env
```

Edit `.env`:
```bash
DATABASE_URL=postgresql://YOUR_USER@localhost:5432/intentional_things
OPENAI_API_KEY=sk-...  # Get from https://platform.openai.com/api-keys
```

### 2.2 Install Dependencies

```bash
npm install
```

This installs:
- `puppeteer` - Headless browser for scraping
- `cheerio` - HTML parsing
- `pg` - PostgreSQL client
- `axios` - HTTP requests

### 2.3 Run Scrapers

Scrape Isthmus (structured event calendar):
```bash
npm run scrape:isthmus
```

Scrape 608today (event articles):
```bash
npm run scrape:608today
```

Or run both:
```bash
npm run scrape:all
```

**Expected output:**
```
🚀 Starting Isthmus scraper...
📄 Scraping page 1...
  Found 15 JSON-LD events, 15 card events
📄 Scraping page 2...
  ...
✅ Scraped 75 total events from Isthmus
💾 Saving events to database...
✅ Database save complete:
   - Inserted: 68
   - Updated: 0
   - Skipped: 7
```

### 2.4 Verify Data

```bash
psql intentional_things -c "
  SELECT source, COUNT(*), MAX(start_time)
  FROM events
  WHERE is_active = TRUE
  GROUP BY source;
"
```

---

## Part 3: Generate Embeddings (Optional)

Vector embeddings enable semantic search ("find cozy activities" matches cafes with warm descriptions).

### 3.1 Get OpenAI API Key

1. Go to https://platform.openai.com/api-keys
2. Create a new API key
3. Add to `.env`: `OPENAI_API_KEY=sk-...`

### 3.2 Generate Embeddings

```bash
node generate-embeddings.js
```

**Cost:** ~$0.001 for 100 activities (very cheap!)

**Expected output:**
```
🏢 Generating embeddings for places...
  Found 8 places without embeddings
  Generating embedding for: Bradbury's Coffee
  ...
✅ Place embeddings complete:
   - Generated: 8
   - Failed: 0

🎉 Generating embeddings for events...
  Found 68 events without embeddings
  ...
✅ Event embeddings complete:
   - Generated: 68
   - Failed: 0
```

### 3.3 When to Skip Embeddings

You can skip this step if:
- You don't need semantic search (just filtering + scoring)
- You want to minimize costs during development
- Your vibe scores are sufficient for matching

The API will work fine without embeddings, just without semantic similarity features.

---

## Part 4: API Server

### 4.1 Install API Dependencies

```bash
cd ../api
npm install
```

### 4.2 Configure Environment

```bash
cp ../.env .env  # Reuse same DATABASE_URL
```

Or create new `.env`:
```bash
DATABASE_URL=postgresql://YOUR_USER@localhost:5432/intentional_things
PORT=3001
```

### 4.3 Start API

Development mode (auto-restart on changes):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

### 4.4 Test API

```bash
# Health check
curl http://localhost:3001/api/health

# Get recommendations
curl -X POST http://localhost:3001/api/recommendations \
  -H "Content-Type: application/json" \
  -d '{
    "timeAvailable": 120,
    "quietSocial": 0.7,
    "insideOutside": 0.5,
    "kidFriendly": false,
    "lowEnergy": true
  }'

# Get stats
curl http://localhost:3001/api/stats
```

---

## Part 5: Integrate with React App

### 5.1 Update App.jsx

Replace the hardcoded `MADISON_PLACES` array with API calls.

**Option A: Direct API Integration (Simple)**

```javascript
// src/App.jsx
const [recommendations, setRecommendations] = useState([]);
const [loading, setLoading] = useState(false);

const handleGetRecommendations = async (preferences) => {
  setLoading(true);

  try {
    const response = await fetch('http://localhost:3001/api/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preferences),
    });

    const data = await response.json();
    setRecommendations(data.recommendations);
    setCurrentScreen('results');
  } catch (err) {
    console.error('Failed to get recommendations:', err);
    alert('Failed to load recommendations. Using cached data.');
    // Fallback to local algorithm
  } finally {
    setLoading(false);
  }
};
```

**Option B: Hybrid Approach (Recommended for MVP)**

Keep local data as fallback, use API when available:

```javascript
// src/api.js
export async function getRecommendations(preferences) {
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  try {
    const response = await fetch(`${API_URL}/api/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preferences),
    });

    if (!response.ok) throw new Error('API request failed');

    const data = await response.json();
    return data.recommendations;
  } catch (err) {
    console.warn('API unavailable, using local data:', err);
    return null; // Fall back to local scoring
  }
}

// src/App.jsx
const handleGetRecommendations = async (preferences) => {
  setLoading(true);

  // Try API first
  const apiResults = await getRecommendations(preferences);

  if (apiResults) {
    setRecommendations(apiResults);
  } else {
    // Fallback to original local algorithm
    const localResults = getRecommendations(MADISON_PLACES, preferences);
    setRecommendations(localResults);
  }

  setCurrentScreen('results');
  setLoading(false);
};
```

### 5.2 Add Environment Variable

Create `.env` in React project root:
```bash
VITE_API_URL=http://localhost:3001
```

For production:
```bash
VITE_API_URL=https://your-api.render.com
```

### 5.3 Update Vite Config (for CORS during dev)

```javascript
// vite.config.js
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
```

Now you can call `/api/recommendations` instead of `http://localhost:3001/api/recommendations`.

---

## Part 6: Deployment

### 6.1 Database (Supabase - Free Tier)

1. Go to https://supabase.com
2. Create new project
3. Go to SQL Editor and run your migrations
4. Get connection string from Settings > Database
5. Update `.env` with new `DATABASE_URL`

**pgvector is included** in Supabase PostgreSQL!

### 6.2 API (Render - Free Tier)

1. Push code to GitHub
2. Go to https://render.com
3. Create new "Web Service"
4. Connect your repo
5. Configure:
   - Build Command: `cd api && npm install`
   - Start Command: `cd api && npm start`
   - Environment Variables: Add `DATABASE_URL`
6. Deploy

### 6.3 Frontend (Keep GitHub Pages)

Update `.env.production`:
```bash
VITE_API_URL=https://your-api.onrender.com
```

Your existing GitHub Actions will handle deployment.

### 6.4 Schedule Scrapers (GitHub Actions)

Create `.github/workflows/scrape-events.yml`:

```yaml
name: Scrape Events Daily
on:
  schedule:
    - cron: '0 6 * * *'  # 6am UTC daily
  workflow_dispatch:  # Manual trigger

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-node@v3
        with:
          node-version: 20

      - name: Install dependencies
        run: cd scrapers && npm install

      - name: Run scrapers
        run: cd scrapers && npm run scrape:all
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

      - name: Generate embeddings
        run: cd scrapers && node generate-embeddings.js
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Add secrets in GitHub repo settings:
- `DATABASE_URL`
- `OPENAI_API_KEY`

---

## Part 7: Monitoring & Maintenance

### 7.1 Check Scraper Health

```sql
-- Last scrape time by source
SELECT
  source,
  COUNT(*) as events,
  MAX(scraped_at) as last_scrape,
  AGE(NOW(), MAX(scraped_at)) as time_since
FROM events
GROUP BY source;
```

### 7.2 Clean Old Events

```sql
-- Mark past events as inactive
UPDATE events
SET is_active = FALSE
WHERE start_time < NOW() - INTERVAL '7 days'
  AND is_active = TRUE;
```

Add to cron:
```bash
0 2 * * * psql $DATABASE_URL -c "UPDATE events SET is_active = FALSE WHERE start_time < NOW() - INTERVAL '7 days';"
```

### 7.3 Monitor Recommendations

```sql
-- Popular recommendations
SELECT
  a.type,
  a.title,
  COUNT(*) as recommended_count
FROM recommendations r
CROSS JOIN LATERAL jsonb_array_elements(r.results) AS result
JOIN activities a ON a.id = (result->>'id')::int AND a.type = result->>'type'
WHERE r.requested_at > NOW() - INTERVAL '7 days'
GROUP BY a.type, a.title
ORDER BY recommended_count DESC
LIMIT 10;
```

---

## Architecture Decisions Explained

### Why Hybrid Search (not pure vector DB)?

**Pros:**
- ✅ Fast filtering on structured constraints (date, time, kid-friendly)
- ✅ Cost-effective (PostgreSQL is cheaper than Pinecone/Weaviate)
- ✅ Easier to debug ("show me why this matched")
- ✅ Better for "intentional" filtering (precise constraints matter)

**Cons:**
- ❌ Slightly more complex than pure vector search
- ❌ Need to maintain two indexes (B-tree + vector)

**When to switch to pure vector DB:**
- 1M+ activities
- Complex multi-modal search (images, audio)
- Need sub-10ms latency at scale

### Why pgvector (not Pinecone)?

**Pros:**
- ✅ No additional service to manage
- ✅ Free tier is generous (Supabase includes it)
- ✅ Single source of truth (data + vectors together)
- ✅ Easy transactions (update data + vector atomically)

**Cons:**
- ❌ Slower at massive scale (>1M vectors)
- ❌ Less sophisticated vector indexing

**When to switch:**
- 100k+ activities per city
- Need advanced features (hybrid query reranking, etc.)

---

## Next Steps

1. **Run scrapers weekly** - Set up GitHub Actions cron
2. **Add more sources** - Madison.com, UW Events, Overture Center
3. **Improve vibe inference** - Use LLMs to tag events with better vibes
4. **User feedback loop** - Track which recommendations get clicked
5. **Multi-city expansion** - Add Chicago, Milwaukee, etc.
6. **Personalization** - Learn user preferences over time

---

## Troubleshooting

### "relation does not exist" error

Your migrations didn't run. Check:
```bash
psql intentional_things -c "\dt"  # List tables
```

Re-run migrations if needed.

### Scraper finds 0 events

Website structure may have changed. Check:
1. Is the site loading? Visit URL manually
2. Inspect page source for JSON-LD or HTML structure
3. Update selectors in scraper if needed

### API returns 500 errors

Check logs:
```bash
npm start  # Look for error messages
```

Common issues:
- Database connection failed (wrong `DATABASE_URL`)
- Missing environment variables
- Database schema mismatch (re-run migrations)

### Embeddings failing

Check OpenAI API key:
```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

Should return a list of models, not an error.

---

## Cost Estimates

**Free tier (0-1k users/month):**
- Database: Supabase free tier (500MB)
- API: Render free tier (750 hours/month)
- Scrapers: GitHub Actions free tier (2000 minutes/month)
- Embeddings: ~$1/month (if regenerating weekly)

**Total: ~$1-2/month**

**Growth phase (1k-10k users/month):**
- Database: Supabase Pro ($25/month)
- API: Render starter ($7/month)
- Embeddings: ~$5/month

**Total: ~$37/month**

---

## Support

Questions? Check:
- `database-schema.md` - Schema details
- `scrapers/README.md` - Scraper docs
- GitHub Issues - Report bugs

Happy building! 🚀
