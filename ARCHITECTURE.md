# Architecture Overview - Intentional Things Finder v2

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER JOURNEY                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User opens app → Input screen                              │
│  2. Sets preferences (time, vibe, constraints)                 │
│  3. Clicks "Go" → API call                                     │
│  4. Receives 3 recommendations                                 │
│  5. Clicks one → Records feedback                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        REACT FRONTEND                           │
│                    (Your existing MVP UI)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  • Input screen (sliders, constraints)                         │
│  • Results screen (3 cards max)                                │
│  • Vibe: quiet/social, inside/outside                          │
│  • Constraints: kid-friendly, low-energy                       │
│                                                                 │
│  CURRENT: Uses local MADISON_PLACES array                      │
│  FUTURE:  POST /api/recommendations                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                                 │
                    POST /api/recommendations
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      RECOMMENDATION API                         │
│                    (Express.js server)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SCORING ALGORITHM:                                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 1. Hard filters (SQL):                                   │  │
│  │    • Time constraints                                    │  │
│  │    • Kid-friendly (if required)                          │  │
│  │    • Active & future events only                         │  │
│  │                                                           │  │
│  │ 2. Vibe scoring (Application):                           │  │
│  │    score = vibeMatch(60pts)                              │  │
│  │          + timeOfDayBonus(20pts)                         │  │
│  │          + timeComfort(10pts)                            │  │
│  │          + randomness(10pts)                             │  │
│  │          - lowEnergyPenalty(15pts)                       │  │
│  │                                                           │  │
│  │ 3. Sort & limit to top 3                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ENDPOINTS:                                                     │
│  • POST /api/recommendations                                   │
│  • GET  /api/activities/:type/:id                              │
│  • POST /api/feedback                                          │
│  • GET  /api/stats                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    POSTGRESQL + pgvector                        │
│                  (Hybrid Search Database)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  TABLES:                                                        │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐         │
│  │  cities    │  │   places   │  │     events       │         │
│  ├────────────┤  ├────────────┤  ├──────────────────┤         │
│  │ id         │  │ id         │  │ id               │         │
│  │ name       │  │ name       │  │ title            │         │
│  │ slug       │  │ type       │  │ start_time       │         │
│  │ timezone   │  │ vibe_quiet │  │ vibe_quiet       │         │
│  │ center_lat │  │ vibe_inside│  │ vibe_inside      │         │
│  └────────────┘  │ story      │  │ venue_name       │         │
│                  │ nudge      │  │ source           │         │
│                  │ tags[]     │  │ categories[]     │         │
│                  │ embedding  │  │ embedding        │         │
│                  └────────────┘  └──────────────────┘         │
│                                                                 │
│  VIEW:                                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │               activities (unified)                       │  │
│  │  = places ∪ events (future only)                        │  │
│  │                                                          │  │
│  │  Used by API for hybrid querying                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  INDEXES:                                                       │
│  • B-tree: time, city_id, type, is_active                      │
│  • GIN: tags, categories (array search)                        │
│  • IVFFlat: embeddings (vector similarity)                     │
│                                                                 │
│  DATA:                                                          │
│  • 8 hand-curated places (from your MVP)                       │
│  • 50-200 scraped events (auto-updated)                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                    ▲                          ▲
                    │                          │
                    │                          │
          ┌─────────┴──────────┐     ┌────────┴────────────┐
          │                    │     │                     │
┌─────────────────────┐  ┌─────────────────────┐  ┌──────────────────┐
│  Isthmus Scraper    │  │ 608today Scraper    │  │ Embedding Gen    │
├─────────────────────┤  ├─────────────────────┤  ├──────────────────┤
│                     │  │                     │  │                  │
│ • Puppeteer         │  │ • Puppeteer         │  │ • OpenAI API     │
│ • JSON-LD parsing   │  │ • Article parsing   │  │ • text-embed-3   │
│ • Category mapping  │  │ • Event extraction  │  │ • 1536-dim       │
│ • Vibe inference    │  │ • Date/time parsing │  │ • Cosine search  │
│                     │  │                     │  │                  │
│ Runs: Daily @ 6am   │  │ Runs: Daily @ 6am   │  │ Runs: On-demand  │
│                     │  │                     │  │                  │
└─────────────────────┘  └─────────────────────┘  └──────────────────┘
         │                         │                        │
         └─────────────────────────┴────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │   GitHub Actions (Cron)      │
                    │   • Scheduled daily runs     │
                    │   • Secrets management       │
                    └──────────────────────────────┘
```

---

## Data Flow Example

### User Request: "Find something quiet and inside, I have 2 hours"

```
1. React Frontend
   └─> POST /api/recommendations
       {
         timeAvailable: 120,
         quietSocial: 0.8,      // Very quiet
         insideOutside: 0.9,    // Strongly inside
         kidFriendly: false,
         lowEnergy: true
       }

2. API Server
   └─> SQL Query:
       SELECT * FROM activities
       WHERE city_id = 1
         AND is_active = TRUE
         AND (type != 'event' OR start_time > NOW())

       ↓ Returns 76 candidates

       ↓ Filter by time constraint:
         totalTime = walk_minutes * 2 + 30
         if totalTime > 120: disqualify

       ↓ Now 58 candidates

       ↓ Score each:
         vibeScore = |0.8 - vibe_quiet| + |0.9 - vibe_inside|
         Bradbury's: vibe(0.7, 0.9) → score = 0.9 + 1.0 = 1.9/2.0 = 95%

         finalScore = vibeScore*60 + timeBonus*20 + comfort*10 + random*10
         Bradbury's: 57 + 20 + 8 + 4.2 = 89.2

       ↓ Sort & limit to 3

       ↓ Return:
         1. Bradbury's Coffee (89.2)
         2. Mystery to Me (84.7)
         3. Olbrich Gardens (78.1)

3. Frontend
   └─> Display 3 cards with story + nudge

4. User clicks Bradbury's
   └─> POST /api/feedback
       { recommendationId: 42, selectedId: 1, selectedType: 'place' }

5. Database
   └─> Log for future learning
```

---

## Search Strategy Comparison

### Pure Vector Search (What you initially suggested)
```
User query → Embedding → Vector similarity search → Results
```

**Pros:**
- Simple architecture
- Great for "fuzzy" queries ("find me something cozy")
- Scales to millions of records

**Cons:**
- ❌ Bad at hard constraints ("must be kid-friendly")
- ❌ Can't enforce time windows
- ❌ Expensive ($70+/month for Pinecone)
- ❌ Black box scoring (hard to debug)

### Hybrid Search (What I built)
```
User query → SQL filters → Vibe scoring → (Optional: Vector boost) → Results
```

**Pros:**
- ✅ Fast constraint filtering
- ✅ Explainable scoring
- ✅ Preserves your MVP algorithm
- ✅ Cheap (~$2/month)
- ✅ Vector search available when needed

**Cons:**
- Slightly more complex
- Need to maintain scoring logic in code

---

## Deployment Architecture

### Development (Local)
```
localhost:5173 (React)
    ↓
localhost:3001 (API)
    ↓
localhost:5432 (PostgreSQL)
```

### Production (Recommended Free Tier)
```
GitHub Pages (Frontend)
    ↓
Render (API - free tier)
    ↓
Supabase (PostgreSQL + pgvector - free tier)
    ↑
GitHub Actions (Scrapers - cron)
```

**Total cost: $0-2/month** (only OpenAI embeddings if used)

---

## Scaling Plan

### Current Capacity (Single City)
- **Places**: 8 curated
- **Events**: ~100 active at any time
- **Users**: 1,000s/month easily
- **Cost**: ~$2/month

### Phase 2 (3-5 Cities)
- **Places**: ~40 curated
- **Events**: ~500 active
- **Users**: 10,000s/month
- **Cost**: ~$25/month
- **Changes needed**: None, just add data

### Phase 3 (10+ Cities, Personalization)
- **Places**: ~100 curated
- **Events**: ~2,000 active
- **Users**: 100,000s/month
- **Cost**: ~$100/month
- **Changes needed**:
  - Redis caching layer
  - Read replicas
  - Consider Pinecone for vector search

---

## Key Design Decisions

### 1. Hybrid Search vs Pure Vector
**Decision:** Hybrid (PostgreSQL + pgvector)
**Rationale:** Events have hard constraints that vectors can't handle

### 2. Embeddings: Optional
**Decision:** Build pipeline but make it optional
**Rationale:** MVP doesn't need semantic search, but future might

### 3. Scrapers: Autonomous
**Decision:** Self-contained scrapers with staging table
**Rationale:** Data quality matters, need human review option

### 4. API: Stateless
**Decision:** No sessions, log everything to database
**Rationale:** Easy to deploy, scale, and learn from

### 5. Frontend: Keep MVP Simple
**Decision:** API is additive, not replacement
**Rationale:** Can deploy database without changing frontend

---

## Next Steps

1. **Set up database** (20 min)
   - Install PostgreSQL + pgvector
   - Run migrations

2. **Test scrapers** (30 min)
   - Configure .env
   - Run one manual scrape
   - Verify data quality

3. **Start API** (10 min)
   - npm install && npm start
   - Test with curl

4. **Connect frontend** (1-2 hours)
   - Add API_URL environment variable
   - Replace MADISON_PLACES with fetch()
   - Test end-to-end

5. **Deploy** (1-2 hours)
   - Supabase for database
   - Render for API
   - GitHub Actions for scrapers

**Total time to production: ~4-6 hours**

---

## Files Reference

- **`IMPLEMENTATION_GUIDE.md`** - Start here for setup
- **`database-schema.md`** - Full schema documentation
- **`scrapers/README.md`** - Scraper documentation
- **`DATABASE_SETUP_SUMMARY.md`** - Quick summary

---

Built with intention 🏛️
