# Next Steps for Intentional Things Finder

## Current Status ✅

- ✅ Isthmus ICS scraper working (83 events imported)
- ✅ GitHub Actions workflow configured
- ✅ Database schema created and populated
- ✅ API server ready at `api/server.js`
- ✅ React frontend ready with API integration

## Critical: Update GitHub Secret

**Before running the workflow**, update the `DATABASE_URL` secret:

1. Go to: https://github.com/setosa-versicolor/intentional-things-finder/settings/secrets/actions
2. Edit `DATABASE_URL` secret
3. Change port from `:5432` to `:6543` and add query parameter

**Current (local only):**
```
postgresql://postgres:PASSWORD@db.tzfygbaambmulgnjwfba.supabase.co:5432/postgres
```

**Should be (for GitHub Actions):**
```
postgresql://postgres:PASSWORD@db.tzfygbaambmulgnjwfba.supabase.co:6543/postgres?pgbouncer=true
```

Why? Supabase blocks direct connections (port 5432) from external IPs. GitHub Actions needs the connection pooler (port 6543).

## To Test Everything

### 1. Test Scrapers in GitHub Actions

After updating the DATABASE_URL secret:
- Go to: https://github.com/setosa-versicolor/intentional-things-finder/actions
- Click "Scrape Events Daily" workflow
- Click "Run workflow" → "Run workflow"
- Watch the logs to see:
  - ✅ Isthmus ICS scraper should work
  - ❓ 608today Puppeteer scraper (might work or fail)

### 2. Start the API Server

```bash
cd api
npm install
npm start
```

Should see: `Server running on http://localhost:3001`

Test it:
```bash
curl http://localhost:3001/api/health
```

### 3. Start the React Frontend

```bash
npm install
npm run dev
```

Open http://localhost:5173 and test the recommendation flow.

## Event Sources

### Working ✅
- **Isthmus** (83 events via ICS feed)
  - Source: https://isthmus.com/search/event/calendar-of-events/calendar.ics
  - Reliable, structured, official data
  - Updates daily via GitHub Actions

### Testing 🧪
- **608today** (Puppeteer scraper)
  - May or may not work - article-based parsing
  - If it fails, we have enough events from Isthmus

### Future Ideas 💡
- Madison.com events calendar
- Visit Madison official calendar
- DoStuffMadison
- Individual venue calendars (Overture, Majestic, High Noon, etc.)

## Files to Know

### Scrapers
- `scrapers/isthmus-ics-scraper.js` - Working ICS parser
- `scrapers/608today-scraper.js` - Puppeteer article scraper
- `scrapers/generate-embeddings.js` - OpenAI vector embeddings (optional)

### API
- `api/server.js` - Express server with recommendation engine
- `api/package.json` - Dependencies

### Frontend
- `src/App.jsx` - Main React app with API integration
- `src/api.js` - API utility functions

### Database
- `migrations/001_initial_schema 2.sql` - Database schema
- `migrations/002_seed_madison_places.sql` - 8 hand-curated places

### Automation
- `.github/workflows/scrape-events.yml` - Daily scraping workflow

## Troubleshooting

### "ENETUNREACH" database error in GitHub Actions
→ Update DATABASE_URL to use port 6543 (see above)

### Scrapers not executing (0 events, no output)
→ Already fixed! Path comparison bug resolved in latest commit

### Puppeteer hangs on Windows
→ Expected. Run scrapers via GitHub Actions instead (Linux)

### API can't connect to database
→ Check that `api/.env` has correct DATABASE_URL (can use port 5432 locally)
