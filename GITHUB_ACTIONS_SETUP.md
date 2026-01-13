# GitHub Actions Setup for Event Scrapers

This guide will help you set up automated event scraping using GitHub Actions, which runs on Linux servers where Puppeteer works reliably.

## Why GitHub Actions?

- ✅ **Puppeteer works reliably** on Linux (not Windows)
- ✅ **Free tier**: 2,000 minutes/month (plenty for daily scraping)
- ✅ **Scheduled execution**: Runs automatically every day
- ✅ **Manual triggers**: Can run on-demand from GitHub UI
- ✅ **No server management** required

---

## Step 1: Push Code to GitHub

If you haven't already:

```bash
cd "C:\Users\jthayer\iCloudDrive\Personal Documents\AI\Apps\Intentional Activities\intentional-things-finder_v2"

# Initialize git (if not already done)
git init
git add .
git commit -m "Add event scrapers and GitHub Actions workflow"

# Create repository on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/intentional-things-finder.git
git branch -M main
git push -u origin main
```

---

## Step 2: Add GitHub Secrets

GitHub Actions needs your database credentials. Add them as secrets (encrypted, safe):

### 2.1 Go to Repository Settings

1. Open your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

### 2.2 Add Required Secret

**Secret 1: DATABASE_URL** (Required)
- **Name**: `DATABASE_URL`
- **Value**: `postgresql://postgres:v0z5VLEk1pxM4Yu8@db.tzfygbaambmulgnjwfba.supabase.co:5432/postgres`
- Click **Add secret**

### 2.3 Add Optional Secret (for embeddings)

**Secret 2: OPENAI_API_KEY** (Optional)
- **Name**: `OPENAI_API_KEY`
- **Value**: Your OpenAI API key (if you want semantic search)
- Click **Add secret**

> **Note:** If you skip the OpenAI key, the workflow will still scrape events but won't generate embeddings.

---

## Step 3: Enable GitHub Actions

1. Go to your repository on GitHub
2. Click the **Actions** tab
3. If prompted, click **I understand my workflows, go ahead and enable them**

---

## Step 4: Test the Workflow

### Option A: Manual Trigger (Recommended First Time)

1. Go to **Actions** tab
2. Click **Scrape Events Daily** in the left sidebar
3. Click **Run workflow** dropdown (top right)
4. Click the green **Run workflow** button
5. Wait 2-3 minutes, then refresh the page
6. Click on the workflow run to see logs

### Option B: Wait for Scheduled Run

The workflow will run automatically at 6am UTC daily (midnight Central Time).

---

## Step 5: Verify Events Were Scraped

After the workflow runs successfully:

### Check GitHub Logs

1. Go to **Actions** tab
2. Click on the latest workflow run
3. Expand each step to see output:
   - ✅ Should see "Found X events from Isthmus"
   - ✅ Should see "Inserted: X" events

### Check Your Database

Run this locally to verify:

```bash
cd "C:\Users\jthayer\iCloudDrive\Personal Documents\AI\Apps\Intentional Activities\intentional-things-finder_v2"
node check-events.js
```

You should see events from `isthmus` and/or `608today` sources!

### Check Your App

Open your app: http://localhost:5173/intentional-things-finder/

Set preferences and click "Find something good" - you should now see events mixed with places!

---

## Troubleshooting

### Workflow Fails Immediately

**Check secrets are set:**
1. Go to Settings → Secrets → Actions
2. Verify `DATABASE_URL` exists
3. The value should start with `postgresql://`

### Scraper Finds 0 Events

**Website structure changed:**
1. Check workflow logs for error messages
2. The scrapers may need updating if Isthmus changes their HTML
3. Open an issue and I can help update the selectors

### Database Connection Error

**Check DATABASE_URL:**
1. Make sure the secret doesn't have extra spaces
2. Try connecting to Supabase dashboard to verify it's running
3. Check if Supabase free tier has limits you've hit

### Puppeteer Timeout

**Increase timeout in scraper:**
Edit `scrapers/isthmus-scraper.js`:
```javascript
await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); // Was 30000
```

---

## Workflow Schedule

The workflow runs:
- **Daily at 6am UTC** (12am/1am Central)
- **On-demand** via manual trigger

To change the schedule, edit `.github/workflows/scrape-events.yml`:

```yaml
schedule:
  - cron: '0 6 * * *'  # Change this line
  # Format: minute hour day month weekday
  # Examples:
  # '0 */6 * * *'  = Every 6 hours
  # '0 12 * * *'   = Noon UTC daily
  # '0 0 * * 0'    = Midnight UTC on Sundays
```

---

## Monitoring

### View Recent Runs

1. Go to **Actions** tab
2. See all past runs with status (✅ success, ❌ failed)
3. Click any run to see detailed logs

### Email Notifications

GitHub will email you if workflows fail (by default).

To disable:
1. Settings → Notifications
2. Uncheck "Actions" under "GitHub Actions"

---

## Cost & Limits

**GitHub Actions Free Tier:**
- 2,000 minutes/month
- Private repositories included
- Public repositories = unlimited

**Your Usage:**
- Each scrape run: ~3-5 minutes
- Daily runs: 30 runs/month × 4 min = 120 minutes/month
- **Well within free tier!** ✅

**Supabase Free Tier:**
- 500 MB database storage
- Unlimited API requests
- Your current data: ~8 places = < 1 MB
- Adding 100+ events/month: ~5-10 MB
- **Still within free tier!** ✅

---

## Next Steps

Once scrapers are working:

1. **Monitor for a week** - Make sure events are being scraped daily
2. **Add more sources** - Find other Madison event calendars to scrape
3. **Improve scrapers** - Add better category detection, vibe inference
4. **Add deduplication** - Detect same event from multiple sources
5. **Add embeddings** - Enable semantic search with OpenAI

---

## Files Reference

- **`.github/workflows/scrape-events.yml`** - GitHub Actions workflow
- **`scrapers/isthmus-scraper.js`** - Isthmus event scraper
- **`scrapers/608today-scraper.js`** - 608today article scraper
- **`scrapers/generate-embeddings.js`** - Embedding generator
- **`check-events.js`** - Local script to check database

---

## Need Help?

If the scrapers aren't working after following these steps:

1. **Check workflow logs** in GitHub Actions tab
2. **Run locally** to test: `cd scrapers && node isthmus-scraper.js`
3. **Open an issue** with the error message

Happy scraping! 🎉
