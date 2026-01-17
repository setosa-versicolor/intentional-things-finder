# Embeddings Setup Guide

## Overview

The app now uses **hybrid scoring** combining explicit preferences with semantic understanding via OpenAI embeddings.

## Scoring Breakdown (Total: ~130 points)

### Explicit Matching (70 points)
- **Vibe scores** (40 points):
  - Quiet/Lively: 20 points
  - Relaxing/Active: 20 points
- **Tag matching** (30 points): Proportional to selected tags

### Semantic Matching (30 points)
- **Embedding similarity**: Captures nuance beyond keywords
- Examples:
  - "cozy date spot" matches romantic cafes even without explicit tags
  - "outdoor adventure" matches hiking/biking without perfect keyword match

### Context Bonuses (30 points)
- **Time of day**: 15 points for appropriate timing
- **Time availability**: 10 points for comfortable fit
- **Randomness**: 5 points for variety

---

## Setup Instructions

### 1. Get OpenAI API Key

1. Sign up at https://platform.openai.com/
2. Go to API Keys: https://platform.openai.com/api-keys
3. Create a new API key
4. Copy the key (starts with `sk-proj-...`)

**Cost**: `text-embedding-3-small` is ~$0.02 per 1M tokens
- 1000 activities ≈ 200k tokens = **$0.004** (less than a penny!)
- Daily scraper updates: ~100 events = **$0.0004/day**

### 2. Add API Key to Environment

**Local Development** (`.env.local`):
```bash
OPENAI_API_KEY=sk-proj-your-key-here
```

**Vercel Production**:
1. Go to https://vercel.com/dashboard
2. Select your project
3. Go to Settings → Environment Variables
4. Add: `OPENAI_API_KEY` = `sk-proj-your-key-here`
5. Redeploy

---

## Generate Embeddings

### For Existing Places (One-time)

```bash
cd /c/Users/jthayer/AIProjects/intentional-things-finder_v2

# Generate for all places
node scripts/generate-embeddings.js --places

# Or both places and events
node scripts/generate-embeddings.js
```

### For Events (Automatic)

The event scraper (`scrapers/isthmus-ics-scraper.js`) now automatically:
- ✅ Generates embeddings for NEW events
- ✅ Reuses existing embeddings for UNCHANGED events
- ✅ Regenerates embeddings if title/description changes

**No duplicate embeddings!** The scraper checks if an event already has an embedding before calling the API.

---

## How It Works

### 1. Activity Embedding Generation

When an activity is created/updated, we generate a semantic representation:

```javascript
// Example for "Bradbury's Coffee"
const semanticText = `
Bradbury's Coffee.
Tucked into the capitol square's northwest corner with excellent coffee and natural light.
Tags: solo-friendly, food-focused, cheap-eats, free.
Quiet atmosphere, indoor space, relaxing activity.
`;

const embedding = await generateEmbedding(semanticText);
// Returns: [0.123, -0.456, 0.789, ...] (1536 numbers)
```

### 2. User Preference Embedding

When a user searches, we convert their preferences to a semantic query:

```javascript
// User selects: quiet, relaxing, food-focused, solo-friendly
const queryText = `
Quiet, peaceful atmosphere.
Relaxing, low-energy activity.
Looking for: food-focused, solo-friendly.
`;

const userEmbedding = await generateEmbedding(queryText);
```

### 3. Similarity Scoring

We use **cosine similarity** to measure how close activities are to user preferences:

```sql
SELECT id, 1 - (embedding <=> $1::vector) as similarity
FROM activities
WHERE embedding IS NOT NULL
ORDER BY similarity DESC
```

Similarity ranges from 0 (unrelated) to 1 (perfect match).

---

## Verification

### Check if embeddings exist:

```bash
# Via API
curl -s https://discovermadison.vercel.app/api/stats

# Should show embedding counts
```

### Check locally:

```javascript
// In Vercel Postgres dashboard or psql:
SELECT
  COUNT(*) FILTER (WHERE embedding IS NOT NULL) as with_embeddings,
  COUNT(*) as total
FROM places;

SELECT
  COUNT(*) FILTER (WHERE embedding IS NOT NULL) as with_embeddings,
  COUNT(*) as total
FROM events
WHERE start_time > NOW();
```

---

## Troubleshooting

### "Embeddings not generating"
- Check: `OPENAI_API_KEY` is set in environment
- Check: Key starts with `sk-proj-` (not `sk-` old format)
- Check: Vercel logs for API errors

### "Duplicate embeddings / High costs"
- The scraper checks existing embeddings before generating
- Only new/changed events trigger API calls
- Check logs: "Reuse existing embedding" vs "Generate new embedding"

### "Semantic scoring not working"
- Embeddings must exist in database
- Run: `node scripts/generate-embeddings.js` to backfill
- API falls back to tag/vibe scoring if embeddings unavailable

---

## Migration Path

**Phase 1** (Now): Embeddings are optional
- If `OPENAI_API_KEY` not set → tag/vibe scoring only
- If key is set → hybrid scoring with 30% semantic boost

**Phase 2** (Later): Make embeddings required
- After validating improved recommendations
- Generate embeddings for all activities upfront

---

## Cost Monitoring

Track OpenAI usage:
1. https://platform.openai.com/usage
2. Set spending limits in OpenAI dashboard
3. Monitor via: `SELECT COUNT(*) WHERE embedding IS NOT NULL`

**Expected monthly cost** (assuming 100 events/week):
- Initial: ~400 events × 200 tokens = 80k tokens = **$0.0016**
- Ongoing: ~100 events/month × 200 tokens = 20k tokens = **$0.0004/month**

Total: **Less than a penny per month!**

---

## Files Modified

- `api/_lib/embeddings.js` - Embedding generation utility
- `api/recommendations.js` - Hybrid scoring algorithm
- `scrapers/isthmus-ics-scraper.js` - Auto-generate event embeddings
- `scripts/generate-embeddings.js` - One-time place embeddings

---

## Questions?

The system degrades gracefully:
- ❌ No API key → Tag/vibe scoring only (still works!)
- ✅ API key set → Hybrid scoring with semantic boost
- ⚡ Embeddings cached → No duplicate API calls

Embeddings make recommendations **smarter** but aren't required for the app to function.
