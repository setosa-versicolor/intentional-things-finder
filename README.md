# Intentional Things Finder

*Three suggestions, max. No scrolling.*

A lightweight app that helps you discover locally unique, intentional experiences—the kind of stuff your east-side Madison friend loves and you consistently gravitate toward when traveling or planning time well.

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
intentional-things-finder/
├── src/
│   ├── App.jsx          # Main app logic and components
│   ├── App.css          # All styling
│   └── index.jsx        # Entry point
├── index.html           # HTML template
├── package.json
├── vite.config.js
└── README.md
```

## Data Architecture

Currently, places are stored as a local array in `App.jsx`. This is intentional for the MVP—it keeps the app simple and lets you personally curate each entry.

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

### Phase 1: Madison MVP (current)
- [x] Core input/output flow
- [x] Place data structure
- [x] Scoring algorithm
- [x] Responsive design
- [x] Dark mode support

### Phase 2: Polish
- [ ] Weather awareness (integrate API, adjust outdoor weighting)
- [ ] "Save for later" functionality
- [ ] Share a suggestion via link
- [ ] PWA support (add to home screen)

### Phase 3: Multi-city
- [ ] City selector
- [ ] Data separated by city (JSON files or simple CMS)
- [ ] User location detection
- [ ] Travel mode (discover a new city)

### Phase 4: Personalization
- [ ] "Not this one" feedback loop
- [ ] Couples mode (two people, shared constraints)
- [ ] "Visiting family" mode
- [ ] Time-of-year awareness

### Phase 5: Agent playground
- [ ] Calendar integration (knows your free windows)
- [ ] Weather-reactive suggestions
- [ ] Learning from feedback
- [ ] Local creator contributions

## Adding New Places

To add a place to Madison, add an entry to the `MADISON_PLACES` array in `src/App.jsx`:

```javascript
{
  id: 9, // increment
  name: "Your Place Name",
  type: "café", // keep these consistent
  neighborhood: "Neighborhood Name",
  vibe: { quiet: 0.7, inside: 0.9 }, // tune these
  bestTimes: ["afternoon"],
  walkMinutes: 15, // from capitol square
  story: "What makes this place special. Be specific. Be opinionated.",
  nudge: "Exact instructions. What to order. Where to sit. What to bring.",
  tags: ["relevant", "tags"],
  coords: { lat: 43.xxxx, lng: -89.xxxx },
  hours: "Human readable hours",
  kidFriendly: true,
  lowEnergy: true
}
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
