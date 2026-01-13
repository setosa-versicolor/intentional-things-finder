# Intentional Things Finder v2

*Three suggestions, max. No scrolling.*

A lightweight app that helps you discover locally unique, intentional experiences—the kind of stuff your east-side Madison friend loves and you consistently gravitate toward when traveling or planning time well.

**Version 2 adds a robust tagged database** with hybrid search, event scrapers, and a recommendation API.

## Philosophy

This is not Yelp. Not Google Maps. Not another "Top 50 Things" list.

It's an app that quietly says: **"You have a free evening. Here's how to not waste it."**

### Core principles

- **Curation over exhaustiveness** — You don't want options. You want the *right* 3 options.
- **Friction reduction** — Each suggestion includes the "go now" details: walking time, hours, what to bring.
- **Intentional design** — No infinite scroll. No algorithm soup. Just enough.

## How it works

**Input (30 seconds):**
- Time available (1 hour to half day)
- Vibe sliders (quiet ↔ social, inside ↔ outside)
- Constraints (kid-friendly, low-energy)

**Output (no scrolling):**
- 3 curated suggestions max
- Each includes: why it fits, a tiny story, and everything you need to go now

## Tech Stack

- **React 18** — Simple component architecture
- **Vite** — Fast development, easy deployment
- **CSS** — Custom properties, no framework (restraint is the point)
- **Google Fonts** — Fraunces (display) + Source Sans 3 (body)

## Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## Project Structure

```
intentional-things-finder_v2/
├── src/                          # React frontend (existing MVP)
│   ├── App.jsx                   # Main app logic
│   ├── App.css                   # All styling
│   └── index.jsx
├── migrations/                    # Database schema
│   ├── 001_initial_schema.sql    # Core tables
│   └── 002_seed_madison_places.sql
├── scrapers/                      # Event scrapers
│   ├── isthmus-scraper.js        # Isthmus calendar
│   ├── 608today-scraper.js       # 608today articles
│   ├── generate-embeddings.js    # Vector embeddings
│   └── README.md
├── api/                           # Recommendation API
│   ├── server.js                 # Express API
│   └── package.json
├── database-schema.md            # Schema documentation
├── IMPLEMENTATION_GUIDE.md       # Step-by-step setup
└── README.md                     # This file
```

## Data Architecture

**V1 (MVP):** Places stored as a local array in `App.jsx` - simple and hand-curated.

**V2 (Current):** PostgreSQL database with:
- **Places table**: Your 8 curated Madison spots (migrated from MVP)
- **Events table**: Scraped from Isthmus and 608today (auto-updated)
- **pgvector embeddings**: Semantic search capability (optional)
- **Hybrid search**: Structured filtering + vibe scoring + vector similarity

See `database-schema.md` for full details.

### Place schema

```javascript
{
  id: number,
  name: string,
  type: string,              // café, bar, garden, walk, bookstore, etc.
  neighborhood: string,
  vibe: {
    quiet: number,           // 0-1 scale
    inside: number           // 0-1 scale
  },
  bestTimes: string[],       // morning, afternoon, evening
  walkMinutes: number,       // from a central point
  story: string,             // the soul of the place
  nudge: string,             // specific "go do this" instructions
  tags: string[],
  coords: { lat, lng },
  hours: string,
  kidFriendly: boolean,
  lowEnergy: boolean
}
```

## Scoring Algorithm

The app uses a simple weighted scoring system:

1. **Time fit** — Walking time × 2 + 30 min must fit in available time
2. **Vibe matching** — Euclidean distance between user sliders and place vibes
3. **Time of day** — Bonus for places optimal for current time
4. **Constraints** — Disqualifies or penalizes based on kid-friendly/low-energy
5. **Controlled randomness** — Small random factor for variety

## Roadmap

### Phase 1: Madison MVP ✅
- [x] Core input/output flow
- [x] Place data structure
- [x] Scoring algorithm
- [x] Responsive design
- [x] Dark mode support

### Phase 2: Polish (current goals)
- [ ] Weather awareness (integrate API, adjust outdoor weighting)
- [ ] "Save for later" functionality
- [ ] Share a suggestion via link
- [ ] PWA support (add to home screen)

### Phase 3: Database Infrastructure ✅ **← We are here!**
- [x] Database schema design
- [x] PostgreSQL + pgvector setup
- [x] Event scrapers (Isthmus, 608today)
- [x] Recommendation API
- [x] Vector embeddings
- [ ] Connect frontend to API
- [ ] Deploy to production

### Phase 4: Multi-city Expansion
- [ ] City selector
- [ ] Add Chicago, Milwaukee data
- [ ] User location detection
- [ ] Travel mode (discover a new city)

### Phase 5: Personalization
- [ ] "Not this one" feedback loop
- [ ] Couples mode (two people, shared constraints)
- [ ] Learning from user choices
- [ ] Time-of-year awareness

### Phase 6: Agent Playground
- [ ] Calendar integration (knows your free windows)
- [ ] Weather-reactive suggestions
- [ ] Advanced learning from feedback
- [ ] Local creator contributions platform

## Quick Start (New Database System)

### 1. Set Up Database
```bash
createdb intentional_things
psql intentional_things < migrations/001_initial_schema.sql
psql intentional_things < migrations/002_seed_madison_places.sql
```

### 2. Run Scrapers
```bash
cd scrapers
npm install
cp .env.example .env  # Add DATABASE_URL and OPENAI_API_KEY
npm run scrape:all
node generate-embeddings.js  # Optional
```

### 3. Start API
```bash
cd api
npm install
npm start  # Runs on http://localhost:3001
```

### 4. Test Recommendations
```bash
curl -X POST http://localhost:3001/api/recommendations \
  -H "Content-Type: application/json" \
  -d '{"timeAvailable": 120, "quietSocial": 0.7, "insideOutside": 0.5, "kidFriendly": false, "lowEnergy": true}'
```

**See `IMPLEMENTATION_GUIDE.md` for detailed setup instructions.**

---

## Adding New Places

**V1 Method (still works for local dev):** Add to `MADISON_PLACES` array in `src/App.jsx`.

**V2 Method (recommended):** Insert into database:

```sql
INSERT INTO places (
  city_id, name, slug, type, neighborhood,
  vibe_quiet, vibe_inside,
  best_times, walk_minutes_from_center,
  story, nudge, tags,
  lat, lng, hours,
  kid_friendly, low_energy, price_level
) VALUES (
  1, -- Madison city_id
  'Your Place Name',
  'your-place-name',
  'café',
  'Neighborhood Name',
  0.7, 0.9, -- vibe scores
  ARRAY['afternoon'],
  15,
  'What makes this place special. Be specific. Be opinionated.',
  'Exact instructions. What to order. Where to sit. What to bring.',
  ARRAY['relevant', 'tags'],
  43.xxxx, -89.xxxx,
  '{"general": "9am-5pm"}',
  TRUE, TRUE, 2
);
```

**Writing good stories:**
- Be specific, not generic
- Include sensory details
- Mention what regulars know
- One strong opinion is better than three weak observations

**Writing good nudges:**
- Be prescriptive: "Order the cortado"
- Include timing: "Best between 2-4pm"
- Reduce friction: "Bring a book" or "Leave your laptop"

## Contributing

This is a personal project, but if you have Madison recommendations that fit the vibe, I'd love to hear them. The bar is high—this isn't a directory, it's a curated list.

## License

MIT

---

*"You have a free evening. Here's how to not waste it."*
