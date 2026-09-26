/**
 * A few hand-picked favorites, used only when the API can't be reached.
 * Same shape as rows from the `activities` view so they run through
 * the shared ranking in api/_lib/recommend.js.
 */

// Same open/close every day, in the stored Google Places format
const daily = (open, close) => ({
  type: 'standard',
  periods: [0, 1, 2, 3, 4, 5, 6].map(day => ({
    open: { day, time: open },
    close: { day: close <= open ? (day + 1) % 7 : day, time: close },
  })),
});

export const FALLBACK_PLACES = [
  {
    type: "place",
    id: 1,
    title: "Bradbury's Coffee",
    category: "café",
    neighborhood: "Capitol Square",
    lat: 43.0747,
    lng: -89.3882,
    vibe_quiet: 0.7,
    vibe_inside: 0.9,
    vibe_active: 0.3,
    description: "Tucked into the capitol square's northwest corner, Bradbury's has that rare combination: excellent coffee, natural light, and tables spaced for actual solitude. The regulars read books here, not laptops.",
    nudge: "Order the cortado. Sit at the window facing the square. Bring something to read that isn't on a screen.",
    tags: [
      "walkable",
      "quiet",
      "solo-friendly"
    ],
    best_times: [
      "morning",
      "afternoon"
    ],
    walk_minutes_from_center: 12,
    hours_today: "7am-6pm",
    hours: daily('0700', '1800'),
    kid_friendly: false,
    low_energy: true
  },
  {
    type: "place",
    id: 2,
    title: "Olbrich Botanical Gardens",
    category: "garden",
    neighborhood: "East Side",
    lat: 43.0894,
    lng: -89.3334,
    vibe_quiet: 0.8,
    vibe_inside: 0.2,
    vibe_active: 0.3,
    description: "The Thai Pavilion catches most visitors, but the real magic is the rock garden path in late afternoon light. It's designed for wandering without purpose—which is, of course, the purpose.",
    nudge: "Enter through the back parking lot. Turn left immediately. Walk slowly. The bench by the pond is worth sitting on for ten minutes.",
    tags: [
      "walkable",
      "outside",
      "peaceful"
    ],
    best_times: [
      "morning",
      "afternoon"
    ],
    walk_minutes_from_center: 25,
    hours_today: "8am-8pm (summer)",
    hours: daily('0800', '2000'),
    kid_friendly: true,
    low_energy: true
  },
  {
    type: "place",
    id: 3,
    title: "The Weary Traveler",
    category: "bar",
    neighborhood: "Willy Street",
    lat: 43.0768,
    lng: -89.3556,
    vibe_quiet: 0.3,
    vibe_inside: 0.8,
    vibe_active: 0.6,
    description: "Not a craft cocktail bar. Not trying to be. The Weary Traveler is where the east side goes to be comfortably social without performance. The patio is the move when weather permits.",
    nudge: "Go on a weeknight. Order whatever's on tap. If the patio's open, claim a corner table. Conversation happens naturally here.",
    tags: [
      "social",
      "casual",
      "local"
    ],
    best_times: [
      "evening"
    ],
    walk_minutes_from_center: 18,
    hours_today: "4pm-close",
    hours: daily('1600', '0200'),
    kid_friendly: false,
    low_energy: false
  },
  {
    type: "place",
    id: 4,
    title: "Tenney Park Lock & Dam",
    category: "walk",
    neighborhood: "Tenney-Lapham",
    lat: 43.0892,
    lng: -89.3678,
    vibe_quiet: 0.6,
    vibe_inside: 0,
    vibe_active: 0.3,
    description: "Most people walk past the lock and dam without stopping. Don't. The water mechanics are oddly meditative, and on summer evenings you'll catch kayakers waiting their turn while herons hunt the shallows.",
    nudge: "Walk the full loop around Tenney Park first (15 min), then end at the lock. Bring nothing. Watch the water.",
    tags: [
      "outside",
      "free",
      "meditative"
    ],
    best_times: [
      "morning",
      "evening"
    ],
    walk_minutes_from_center: 20,
    hours_today: "Always open",
    hours: { type: 'always_open', always_open: true },
    kid_friendly: true,
    low_energy: true
  },
  {
    type: "place",
    id: 5,
    title: "Mystery to Me",
    category: "bookstore",
    neighborhood: "Monroe Street",
    lat: 43.0628,
    lng: -89.4142,
    vibe_quiet: 0.8,
    vibe_inside: 0.9,
    vibe_active: 0.3,
    description: "An independent bookstore that actually feels independent. The staff recommendations are genuine (and weird in the right ways). The mystery section is deep, but don't sleep on their literary fiction picks.",
    nudge: "Ask whoever's working what they just finished reading. Buy something you wouldn't have found on your own. Walk to Colectivo after.",
    tags: [
      "quiet",
      "browsing",
      "local"
    ],
    best_times: [
      "afternoon"
    ],
    walk_minutes_from_center: 22,
    hours_today: "10am-7pm",
    hours: daily('1000', '1900'),
    kid_friendly: true,
    low_energy: true
  },
  {
    type: "place",
    id: 6,
    title: "Garver Feed Mill",
    category: "market",
    neighborhood: "East Side",
    lat: 43.0912,
    lng: -89.3289,
    vibe_quiet: 0.4,
    vibe_inside: 0.6,
    vibe_active: 0.6,
    description: "A beautifully restored feed mill that now houses local food vendors and makers. Ian's Pizza, Underground Food Collective, Ledger Coffee. It's a destination that earns the walk.",
    nudge: "Saturday morning is busy but worth it. Get coffee from Ledger, browse the Dane County Farmers' Market extension, then sit in the courtyard.",
    tags: [
      "food",
      "local",
      "weekend"
    ],
    best_times: [
      "morning",
      "afternoon"
    ],
    walk_minutes_from_center: 30,
    hours_today: "7am-9pm",
    hours: daily('0700', '2100'),
    kid_friendly: true,
    low_energy: false
  },
  {
    type: "place",
    id: 7,
    title: "Picnic Point",
    category: "nature",
    neighborhood: "UW Campus",
    lat: 43.0858,
    lng: -89.4275,
    vibe_quiet: 0.9,
    vibe_inside: 0,
    vibe_active: 0.6,
    description: "A narrow peninsula stretching into Lake Mendota. The walk out and back is exactly long enough to process something you've been avoiding thinking about. Sunset from the point is Madison's best free show.",
    nudge: "Go alone. Leave your phone in your pocket until you reach the tip. On the way back, you'll know what you needed to figure out.",
    tags: [
      "nature",
      "solo",
      "meditative"
    ],
    best_times: [
      "morning",
      "evening"
    ],
    walk_minutes_from_center: 35,
    hours_today: "4am-11pm",
    hours: daily('0400', '2300'),
    kid_friendly: true,
    low_energy: false
  },
  {
    type: "place",
    id: 8,
    title: "Daisy Cafe & Cupcakery",
    category: "café",
    neighborhood: "Atwood",
    lat: 43.0891,
    lng: -89.3456,
    vibe_quiet: 0.5,
    vibe_inside: 0.7,
    vibe_active: 0.3,
    description: "Brunch with personality. The space is small and a little loud, which somehow makes it feel more alive. The cupcakes are what they're known for, but the savory menu is the real draw.",
    nudge: "Weekday breakfast avoids the weekend wait. Get the Atwood scramble. Take a cupcake to go for later.",
    tags: [
      "food",
      "local",
      "casual"
    ],
    best_times: [
      "morning",
      "afternoon"
    ],
    walk_minutes_from_center: 15,
    hours_today: "7am-3pm",
    hours: daily('0700', '1500'),
    kid_friendly: true,
    low_energy: true
  }
];
