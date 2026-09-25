# Intentional Things Finder: Review & Improvement Plan

*Written September 2026, reviewing the code as of `9186721` ("Add seasonal filtering to recommendations").*

---

## TL;DR

The concept is strong. "Three suggestions, max. No scrolling." is a real point of view, and the story/nudge voice in the content drafts is the best thing in the repo. The execution undercuts it in three ways:

1. **Several bugs quietly break the core promise.** In production, "open now" and "time of day" are computed in UTC. Seasonal filtering never shipped to the deployed API. The offline fallback always returns nothing. Events from weeks away can show up as "go now".
2. **The data is thin where it matters.** About 40% of places have placeholder hours. "Walk minutes" is measured from downtown, not from you. Several of the tags you can pick match zero places. The app knows nothing about weather, sunset, the lakes, or what's happening this week beyond one Isthmus feed.
3. **The UX asks too much and gives back too little.** It opens with six inputs before you see anything. The cards are static text. There's no memory, no "I went", no reason to come back.

The plan: **fix the foundation (about 1 week), then build a "live Madison" data layer, then redesign around zero-input first use and real-time context, then add the fun: a passport, micro-itineraries, share cards, and seasonal moments.**

---

## Part 1: Review

### What's working (keep it)

- **The constraint.** Three cards and no feed is the product. Don't give it up.
- **The voice.** Lines like *"Not a craft cocktail bar. Not trying to be."* and *"Bring nothing. Watch the water."* are what set this apart from Google Maps. `CONTENT_EXPANSION_PLAN.md` describes the voice well.
- **Hybrid scoring.** Vibe, tags, embeddings, and time of day is a sensible base.
- **Serverless on Vercel plus Postgres/pgvector.** This is cheap and has room to grow.

### Critical bugs (the app is quietly wrong)

| # | Issue | Where | Effect |
|---|---|---|---|
| 1 | **Server timezone is UTC.** `getTimeOfDay()` and `isCurrentlyOpen()` use `new Date().getHours()` and `toTimeString()`, and Vercel functions run in UTC. | `api/_lib/db.js:24`, `api/_lib/hours.js:23-25` | At 7pm in Madison it's midnight UTC. Evening searches score as "morning" and **filter out most places as closed**. Morning searches let bars through. |
| 2 | **Seasonal filtering never reached production.** The last commit changed `api/server.js` (the local Express server). The deployed handler `api/recommendations.js` has no season check. No migration adds `seasons` to the `activities` view either, so `server.js` would fail on that column. | `api/recommendations.js`, `migrations/004_add_business_status.sql` view | Sledding hills in July and kayak rentals in January. This is the exact bug the commit meant to fix. |
| 3 | **The local fallback always returns nothing.** `scorePlace` reads `preferences.quietSocial` and `insideOutside`, but the form now sends `quietToLively`, `activeToRelaxing`, and `location`. The score becomes `NaN`, and `NaN >= 0` is false, so every place is dropped. | `src/App.jsx:157-158` | Whenever the API is down, and on **every visit to the GitHub Pages deploy** (which has no API), the user sees "Nothing quite matches." |
| 4 | **The chosen date/time is mostly ignored.** Places are checked against *now*, not the requested time. Events only have a lower bound, so an event 12 days out can fill a "go now" slot. The results greeting also uses the current time. | `api/recommendations.js:143-157`, `src/App.jsx:510` | "Saturday 10am" gives you whatever is open right now. |
| 5 | **Date picker shows UTC.** `toISOString().slice(0,16)` feeds a `datetime-local` input. | `src/App.jsx:346-350,369` | The picker is 5–6 hours off for Madison users. |
| 6 | **Events render with broken fields.** Events have no `walk_minutes_from_center`, `nudge`, or `hours`. | `src/App.jsx:401`, `App.jsx:571-576` | Cards show "null min walk", "Enjoy your visit!", and "Check website". |
| 7 | **The feedback loop is dead.** `sendFeedback` is never called, and the recommendations insert doesn't `RETURNING id`, so the client couldn't reference the row anyway. | `src/api.js:69`, `api/recommendations.js:237` | No learning signal is collected. |
| 8 | **There is no loading state.** `loading` is passed to `ResultsScreen` and never used. The button doesn't disable. | `src/App.jsx:497, 616` | The OpenAI embedding call plus the DB takes 1–2s of nothing happening, and double-submits are possible. |

### Data quality

From `discover-madison-places.csv` (197 places):

- **Hours are mostly templates.** 37 places are exactly `16:00–02:00`, 31 are `11:00–21:00`, 24 are `07:00–18:00`, and all are marked `hours_verified: false`. The Google Places sync exists (`scripts/sync-google-places.js`), but the CSV suggests it hasn't covered everything.
- **"Walk minutes from center" isn't meaningful.** It's travel time from the Capitol, not from the user, and it's null for most imported places. The time-budget filter therefore does nothing for them.
- **The tag vocabulary has drifted.** The UI offers `dog-friendly` (0 places) and `unusual-options` (2). The data also has near-duplicates like `date-night`/`date night`, `kid-friendly`/`kids`/`family`, and `outdoor`/`nature`.
- **The types are too coarse.** 34 places are typed `other`. The neighborhood for 29 places is just "Madison", and 6 are "Multiple locations".
- **The last bulk import failed.** `import-log.txt` shows 0 inserted and 99 errors (`type` was null). It's worth confirming what's actually in the production DB.

### Architecture and hygiene

- **Two copies of the recommendation logic.** `api/server.js` (Express, old input format) and `api/recommendations.js` (Vercel) have already drifted, which is bug #2. There should be one scoring module with unit tests.
- **Two deploy targets.** GitHub Pages (`deploy.yml`) and Vercel. Pages can't reach the API, so it always hits bug #3. Pick Vercel and remove the Pages workflow.
- **`.env.production` is committed** and contains a Vercel OIDC token. It's scoped to development and expired in January, but the file should be deleted and ignored.
- **Migrations are messy.** Numbers collide (two `002`, two `003`, two `004`) and one file is named `001_initial_schema 2.sql`, with a space. Renumber them and track which have been applied.
- **Every request pays for an OpenAI embedding call.** The preference text has low cardinality (slider buckets and tags), so cache it or precompute the buckets.
- **No tests, linting, or CI checks.**
- **About 10 planning and setup markdown files in the root.** Consolidate them into `docs/`.

### UX

- **Too much friction before any value.** Time, two sliders, location, 13 tags, and date/time is about 20 decisions before the first suggestion. That contradicts the app's own "30 seconds" promise.
- **The sliders are abstract.** "Atmosphere: quiet ↔ lively" at 0.5 means nothing to people. Moods and scenarios are easier to choose from.
- **The cards leave out the "go now" details.** There's no distance from me, no "open until 9", and no weather, even though the README promises "walking time, hours, what to bring."
- **No way to reject or refine.** You can only go "← Different mood" and start over. There's no "not this one" swap.
- **No memory.** The app doesn't know what you've already done or loved, and has no reason to open it again.
- **Accessibility.** Toggle buttons lack `aria-pressed`, sliders have no accessible value text, and there's no focus management between screens.

---

## Part 2: Additional data sources

The goal is to make the app feel like it knows what's happening in Madison **right now**. Sources are roughly ordered by value per unit of effort.

### Tier 1: high impact, free, low effort

| Source | What it unlocks | Access |
|---|---|---|
| **National Weather Service API** (`api.weather.gov`) | Rain, temperature, wind, and hourly forecast. Downrank outdoor picks in a thunderstorm and uprank the Terrace on a perfect 72° evening. | Free, no key. Needs a User-Agent. |
| **Sun position** (`suncalc` npm, computed locally) | Exact sunset and golden hour, e.g. "Sunset in 38 min: leave by 7:02 for Picnic Point." Replaces the hardcoded month table in `hours.js:getSunsetTime`. | Library, no API |
| **Browser geolocation plus haversine or a routing API** | Real "12 min walk / 6 min bike from you". Makes the time-budget filter meaningful. | Built-in. Routing via OSRM, Mapbox, or Google Directions. |
| **Google Places (already integrated)** | Finish the hours sync for all places. Add `currentOpeningHours`, `editorialSummary`, and one photo per place. | Existing key |
| **More ICS feeds.** Madison Public Library ([calendar subscription feeds](https://www.madisonpubliclibrary.org/spaces/events/calendar-subscription-feeds)) and UW–Madison events ([today.wisc.edu feeds](https://today.wisc.edu/), e.g. "All arts" and "Featured"). | Free lectures, readings, concerts, museum nights. These are very "intentional" events. | ICS, and the existing `parseICS` already handles them |

### Tier 2: live Madison conditions (this is where it gets fun)

| Source | What it unlocks |
|---|---|
| **Lake Mendota buoy** ([SSEC/NTL-LTER](https://metobs.ssec.wisc.edu/mendota/buoy/)): surface water temp, wind, and gusts every minute, Apr–Nov | "Mendota is 71° at the surface. It's a swimming day." "Gusts 25 mph: skip the paddleboard." |
| **Beach status** ([Public Health Madison & Dane County](https://www.publichealthmdc.com/environmental-health/beaches-lakes-pools/beach-conditions/), [Lake Forecast](https://lakeforecast.org/map/beach/)) | Never recommend a beach closed for E. coli or blue-green algae. Tested weekly, Memorial Day to Labor Day. |
| **Madison Parks ice rink and sledding status** ([ice skating page](https://www.cityofmadison.com/parks/iceskating), [sledding](https://www.cityofmadison.com/parks/find-a-park/winter/sledding)) | "Tenney lagoon: OPEN, updated this morning." Winter picks become trustworthy. This probably needs a small scraper. |
| **Madison BCycle GBFS** (`gbfs.bcycle.com/bcycle_madison/gbfs.json`, [GBFS info](https://www.bcycle.com/gbfs)) | "4 e-bikes at the station 2 blocks away. Bike there in 9 min." |
| **City of Madison Open Data** ([ArcGIS portal](https://data-cityofmadison.opendata.arcgis.com/datasets/parks)) | Park boundaries, amenities, and [bike share stations](https://data-cityofmadison.opendata.arcgis.com/maps/cityofmadison::bike-share-stations). Seed places and fix neighborhoods from polygons instead of free text. |
| **Madison Metro GTFS / GTFS-realtime** | Transit time for people without a car or bike. |

### Tier 3: delight data

| Source | What it unlocks |
|---|---|
| **iNaturalist API** (free, no key) | "Great blue herons were spotted at Tenney 3 times this week." It turns nature picks into small treasure hunts. |
| **eBird API** (free key), Dane County notable sightings | "A snowy owl has been seen near the Arboretum since Tuesday." |
| **AirNow / Purple Air** | Downrank outdoor picks on wildfire-smoke days. |
| **Wisconsin State Climatology Office lake ice records** | Ice-on and ice-off dates for Mendota and Monona. Seasonal moments like "Mendota froze last night. Go look." |
| **UW Athletics schedule (ICS)** | Game-day awareness: steer clear of Camp Randall traffic, or lean into it. |
| **Space Place / Washburn Observatory public nights**, plus a clear-sky forecast | "Clear skies and the observatory is open tonight." |
| **Curated seasonal calendar** (hand-maintained JSON) | Farmers' Market on the Square, Art Fair, lilacs at the Arboretum's Longenecker Gardens, Olbrich's holiday flower show, Friday fish fry. It's cheap to maintain and has a lot of personality. |

### Using an LLM in the data pipeline (optional, behind a flag)

- **Event triage.** Scraped Isthmus, library, and UW events vary a lot in quality. A cheap classification pass (e.g. Claude Haiku 4.5) could assign `vibe_*`, tags, and an "is this intentional?" score, and write a one-line nudge in the house voice. Keep a human-review queue for anything promoted to a *place*.
- **A "why now" line per card at request time**, generated from the live context: *"It's 68°, sunset is at 7:14, and you said quiet. The pier at James Madison is basically yours."* Cache it per (place, context bucket) so it stays cheap.

---

## Part 3: Product direction

> **A friend who knows Madison, texting you three ideas.**

Every change should make the app feel more like that friend: aware of the weather, knows what's on tonight, remembers what you liked, and never hands you a list of 50.

### Core UX redesign

1. **Zero-input first screen.** On open, immediately show three picks for *right now* at your location, using time, weather, and season. Refining is optional and sits behind a "Tune it" drawer. First value arrives in under two seconds.
2. **Moods instead of sliders.** Offer one-tap scenario chips: *Need to think · Date night · Kid energy to burn · Rainy afternoon · Out-of-towner visiting · Cheap & cheerful · Surprise me.* Each maps to the existing vibe and tag vector. Keep the sliders as an "advanced" option.
3. **Time as a single dial:** "I have *[1h / 2h / the evening / the whole day]*, starting *[now / later today / Saturday]*."
4. **Cards built around leaving the house:**
   - Status line: **Open until 9 · 12 min walk · 64° and clear**
   - The story, then the nudge (these stay the heart of the card)
   - Live chips: *Sunset 7:14* · *3 BCycles nearby* · *Herons spotted this week* · *Beach closed: algae*
   - Actions: **Go** (maps deep link) · **Swap** (replaces only this card) · **Save** · **Share**
5. **Card roles instead of three of a kind.** Pick 1 is the **Sure Thing** (best match), pick 2 is **Something Different** (another category), and pick 3 is the **Wildcard** (`outside-my-norm`, a live event, or a seasonal moment). This fixes the "three cafés" problem and gives each card a personality.
6. **"I went" instead of star ratings.** A day later, ask with one tap: "Did you go to Picnic Point? 👍 / 😐 / didn't go." That's the feedback loop, and it drives the passport below.

### Scoring and engine upgrades

- **Real timezone handling.** Compute everything in `America/Chicago`, e.g. with `Intl.DateTimeFormat` or Luxon.
- **Open for the whole visit.** The place must be open at arrival *and* for about 45 min after, and the event must start within the time window.
- **Travel time from the user**, not from the Capitol.
- **Context multipliers:** weather (rain or cold downranks `vibe_inside < 0.4`), daylight (outdoor picks after sunset only if lit or explicitly nighttime), season, beach and rink status.
- **Diversity.** Use MMR re-ranking over type, neighborhood, and embedding so the three picks differ.
- **Novelty.** Downrank anything shown in the last N sessions or already visited, tracked locally or per account.
- **Learning.** Use "I went 👍" and swap signals to nudge per-user vibe weights. Keep it simple: a small per-user vector adjustment is enough.
- **One module, tested.** Build `api/_lib/recommend.js` as pure functions (candidates + context → ranked picks) with a fixture-based test suite: "Tuesday 7pm, January, raining, 1 hour, quiet → no beaches, no closed places, ≥2 categories."

### The fun layer (what makes people come back)

- **🗺️ Madison Passport.** A hand-drawn-style map of the isthmus. Each "I went" stamps a neighborhood, and the map fills in with watercolor over time. Collections to complete:
  - **Four Lakes** (Mendota, Monona, Wingra, Waubesa, Kegonsa; yes, it's five, and that's the joke)
  - **Year-Rounder:** the same spot in all four seasons
  - **Isthmus Crosser:** east side and west side in one day
  - **Night Owl, Early Bird, Supper Club Circuit, Fish Fry Friday**
- **🎲 Surprise me.** Shake the phone or tap the dice. The card flips over like a tarot card to reveal one pick, with no inputs.
- **🌅 Live atmosphere.** Extend the existing inside/outside atmosphere effect so it reflects the *actual* sky: golden-hour gradient near sunset, soft rain animation when it's raining, falling snow in winter, a starfield after dark. Keep it subtle.
- **🧭 "Make it an evening."** For 3+ hour windows, chain two or three nearby picks into a micro-itinerary using the nudges that already reference neighbors (*"Walk to Colectivo after"*): **Mystery to Me → Colectivo → sunset at Wingra.**
- **💌 Share cards.** Generate a postcard-style image with the name, a one-line nudge, and the time ("Tonight, 7pm?"), sent with one tap to a friend. A **group pick** link lets two to four people each veto a card and see what survives.
- **🍂 Seasonal moments.** An occasional banner above the cards: "Mendota froze overnight," "Lilacs are peaking at the Arboretum this week," "First Farmers' Market on the Square is Saturday." These are rare enough to feel special.
- **💬 Voice everywhere.** Loading lines like *"Asking a Willy Street regular…"* and *"Checking whether the Terrace chairs are out…"*. The empty state becomes *"Honestly? Go home and read. But if you must: [one fallback pick]."* Friday evenings mention fish fry.
- **📌 A "Someday" list capped at 5.** Saving something means you intend to do it. The cap keeps it intentional instead of becoming another backlog.
- **📱 PWA.** Installable, fast from the home screen, and caches the last results for offline use.

---

## Part 4: Phased roadmap

### Phase 0: Make it correct ✅ (done)

- [x] Fix timezone handling in `db.js` and `hours.js` (use America/Chicago throughout). Add tests.
- [x] Move seasonal filtering into `api/recommendations.js`. It reads `seasons` from `places` via a join, so no view change is needed.
- [x] Honor the requested date/time for place hours, event windows, and the greeting.
- [x] Fix the local fallback. It now runs through the same ranking code as the API.
- [x] Render events correctly (time, venue, "starts in 40 min").
- [x] Add a loading state and disable double-submit.
- [x] Fix the date picker timezone.
- [x] Make the recommendation insert `RETURNING id` and wire up `sendFeedback`.
- [x] Remove the GitHub Pages workflow, delete `.env.production`, and renumber the migrations.
- [x] Make `server.js` serve the same handlers Vercel deploys.
- [x] Add Vitest with scoring and hours tests, plus a test and build GitHub Action.
- [x] *Found along the way:* fix the inverted quiet/lively scoring, the inverted energy wording in the embedding query, `best_times` never reaching the scorer, Google's Monday-first `weekday_text` being read Sunday-first, Places API (New) hours being stored without times, and ICS event times being read as UTC.

### Phase 1: Data foundation (about 1–2 weeks)

- [ ] Finish the Google hours sync for all places and show "open until X".
- [ ] Normalize tags to a controlled vocabulary with a migration. Drop UI tags that match nothing, or backfill them (e.g. `dog-friendly`).
- [ ] Replace free-text neighborhoods with polygons from Madison Open Data.
- [ ] Add weather (NWS) and sun (suncalc) as request-time context, cached for about 10 min.
- [ ] Add Madison Public Library and UW events ICS feeds to the cron job, with dedup.
- [ ] Optional: an LLM triage pass for scraped events.

### Phase 2: UX redesign (about 2 weeks)

- [ ] Zero-input "right now" home screen with geolocation.
- [ ] Mood chips and the time dial. Move the sliders into "Tune it".
- [ ] New card anatomy with live chips and Go / Swap / Save / Share.
- [ ] Card roles (Sure Thing / Something Different / Wildcard) and MMR diversity.
- [ ] The "Did you go?" follow-up.
- [ ] Accessibility pass.

### Phase 3: Delight (ongoing)

- [ ] Live atmosphere (sky, weather, time of day).
- [ ] Surprise-me card flip.
- [ ] Passport map and collections.
- [ ] Micro-itineraries.
- [ ] Share postcards and group pick.
- [ ] Seasonal moments calendar, plus live lake, beach, rink, and bird data.
- [ ] PWA.

### Phase 4: Learn (after there are real users)

- [ ] Per-user preference adjustment from went, liked, and swapped signals.
- [ ] A small admin view: which places never get picked or always get swapped, and which have stale hours.

---

## How we'll know it's working

- **Time to first suggestion:** under 2 s, with 0 required taps.
- **Swap rate per card:** a high rate means the scoring or content is off for that place.
- **"I went" rate:** the north-star metric. It measures whether the app gets people out of the house.
- **Return visits per week**, and passport stamps per active user.
- **Zero bad picks:** no closed places, no out-of-season picks, no closed beaches. Enforce this with fixture tests.

## Open questions for you

1. **Accounts or anonymous?** Local-only storage (passport, history) is the fastest to build. Accounts via Supabase Auth enable cross-device use and group picks.
2. **Madison-only, or multi-city eventually?** The schema already has `cities`. It changes how much we invest in hand-curated seasonal content versus generic sources.
3. **Should LLM-written copy ever reach users unreviewed**, or only as drafts for you to edit? The voice is the product, so I'd default to drafts only.
