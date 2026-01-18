import React, { useState, useEffect } from 'react';
import './App.css';
import { getRecommendations as getRecommendationsAPI } from './api';

// Madison-specific curated places (this becomes a data layer later)
const MADISON_PLACES = [
  {
    id: 1,
    name: "Bradbury's Coffee",
    type: "café",
    neighborhood: "Capitol Square",
    vibe: { quiet: 0.7, inside: 0.9 },
    bestTimes: ["morning", "afternoon"],
    walkMinutes: 12,
    story: "Tucked into the capitol square's northwest corner, Bradbury's has that rare combination: excellent coffee, natural light, and tables spaced for actual solitude. The regulars read books here, not laptops.",
    nudge: "Order the cortado. Sit at the window facing the square. Bring something to read that isn't on a screen.",
    tags: ["walkable", "quiet", "solo-friendly"],
    coords: { lat: 43.0747, lng: -89.3882 },
    hours: "7am-6pm",
    kidFriendly: false,
    lowEnergy: true
  },
  {
    id: 2,
    name: "Olbrich Botanical Gardens",
    type: "garden",
    neighborhood: "East Side",
    vibe: { quiet: 0.8, inside: 0.2 },
    bestTimes: ["morning", "afternoon"],
    walkMinutes: 25,
    story: "The Thai Pavilion catches most visitors, but the real magic is the rock garden path in late afternoon light. It's designed for wandering without purpose—which is, of course, the purpose.",
    nudge: "Enter through the back parking lot. Turn left immediately. Walk slowly. The bench by the pond is worth sitting on for ten minutes.",
    tags: ["walkable", "outside", "peaceful"],
    coords: { lat: 43.0894, lng: -89.3334 },
    hours: "8am-8pm (summer)",
    kidFriendly: true,
    lowEnergy: true
  },
  {
    id: 3,
    name: "The Weary Traveler",
    type: "bar",
    neighborhood: "Willy Street",
    vibe: { quiet: 0.3, inside: 0.8 },
    bestTimes: ["evening"],
    walkMinutes: 18,
    story: "Not a craft cocktail bar. Not trying to be. The Weary Traveler is where the east side goes to be comfortably social without performance. The patio is the move when weather permits.",
    nudge: "Go on a weeknight. Order whatever's on tap. If the patio's open, claim a corner table. Conversation happens naturally here.",
    tags: ["social", "casual", "local"],
    coords: { lat: 43.0768, lng: -89.3556 },
    hours: "4pm-close",
    kidFriendly: false,
    lowEnergy: false
  },
  {
    id: 4,
    name: "Tenney Park Lock & Dam",
    type: "walk",
    neighborhood: "Tenney-Lapham",
    vibe: { quiet: 0.6, inside: 0.0 },
    bestTimes: ["morning", "evening"],
    walkMinutes: 20,
    story: "Most people walk past the lock and dam without stopping. Don't. The water mechanics are oddly meditative, and on summer evenings you'll catch kayakers waiting their turn while herons hunt the shallows.",
    nudge: "Walk the full loop around Tenney Park first (15 min), then end at the lock. Bring nothing. Watch the water.",
    tags: ["outside", "free", "meditative"],
    coords: { lat: 43.0892, lng: -89.3678 },
    hours: "Always open",
    kidFriendly: true,
    lowEnergy: true
  },
  {
    id: 5,
    name: "Mystery to Me",
    type: "bookstore",
    neighborhood: "Monroe Street",
    vibe: { quiet: 0.8, inside: 0.9 },
    bestTimes: ["afternoon"],
    walkMinutes: 22,
    story: "An independent bookstore that actually feels independent. The staff recommendations are genuine (and weird in the right ways). The mystery section is deep, but don't sleep on their literary fiction picks.",
    nudge: "Ask whoever's working what they just finished reading. Buy something you wouldn't have found on your own. Walk to Colectivo after.",
    tags: ["quiet", "browsing", "local"],
    coords: { lat: 43.0628, lng: -89.4142 },
    hours: "10am-7pm",
    kidFriendly: true,
    lowEnergy: true
  },
  {
    id: 6,
    name: "Garver Feed Mill",
    type: "market",
    neighborhood: "East Side",
    vibe: { quiet: 0.4, inside: 0.6 },
    bestTimes: ["morning", "afternoon"],
    walkMinutes: 30,
    story: "A beautifully restored feed mill that now houses local food vendors and makers. Ian's Pizza, Underground Food Collective, Ledger Coffee. It's a destination that earns the walk.",
    nudge: "Saturday morning is busy but worth it. Get coffee from Ledger, browse the Dane County Farmers' Market extension, then sit in the courtyard.",
    tags: ["food", "local", "weekend"],
    coords: { lat: 43.0912, lng: -89.3289 },
    hours: "7am-9pm",
    kidFriendly: true,
    lowEnergy: false
  },
  {
    id: 7,
    name: "Picnic Point",
    type: "nature",
    neighborhood: "UW Campus",
    vibe: { quiet: 0.9, inside: 0.0 },
    bestTimes: ["morning", "evening"],
    walkMinutes: 35,
    story: "A narrow peninsula stretching into Lake Mendota. The walk out and back is exactly long enough to process something you've been avoiding thinking about. Sunset from the point is Madison's best free show.",
    nudge: "Go alone. Leave your phone in your pocket until you reach the tip. On the way back, you'll know what you needed to figure out.",
    tags: ["nature", "solo", "meditative"],
    coords: { lat: 43.0858, lng: -89.4275 },
    hours: "4am-11pm",
    kidFriendly: true,
    lowEnergy: false
  },
  {
    id: 8,
    name: "Daisy Cafe & Cupcakery",
    type: "café",
    neighborhood: "Atwood",
    vibe: { quiet: 0.5, inside: 0.7 },
    bestTimes: ["morning", "afternoon"],
    walkMinutes: 15,
    story: "Brunch with personality. The space is small and a little loud, which somehow makes it feel more alive. The cupcakes are what they're known for, but the savory menu is the real draw.",
    nudge: "Weekday breakfast avoids the weekend wait. Get the Atwood scramble. Take a cupcake to go for later.",
    tags: ["food", "local", "casual"],
    coords: { lat: 43.0891, lng: -89.3456 },
    hours: "7am-3pm",
    kidFriendly: true,
    lowEnergy: true
  }
];

// Time-of-day detection
const getTimeOfDay = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
};

// Scoring algorithm for matching places to preferences
const scorePlace = (place, preferences) => {
  let score = 0;
  
  // Time available (walking time must fit)
  const totalTimeNeeded = place.walkMinutes * 2 + 30; // walk there, spend time, walk back
  if (totalTimeNeeded > preferences.timeAvailable) {
    return -1; // disqualify
  }
  score += (preferences.timeAvailable - totalTimeNeeded) * 0.1; // bonus for comfortable fit
  
  // Vibe matching (0-1 scale)
  const quietMatch = 1 - Math.abs(place.vibe.quiet - preferences.quietSocial);
  const insideMatch = 1 - Math.abs(place.vibe.inside - preferences.insideOutside);
  score += quietMatch * 30 + insideMatch * 30;
  
  // Time of day appropriateness
  const currentTime = getTimeOfDay();
  if (place.bestTimes.includes(currentTime)) {
    score += 20;
  }
  
  // Constraint matching
  if (preferences.kidFriendly && !place.kidFriendly) {
    return -1; // disqualify
  }
  if (preferences.lowEnergy && !place.lowEnergy) {
    score -= 15;
  }
  
  // Add some controlled randomness for variety
  score += Math.random() * 10;
  
  return score;
};

// Get curated recommendations
const getRecommendations = (preferences, count = 3) => {
  const scored = MADISON_PLACES
    .map(place => ({ place, score: scorePlace(place, preferences) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score);
  
  return scored.slice(0, count).map(({ place }) => place);
};

// Components
const VibeSlider = ({ label, leftLabel, rightLabel, value, onChange }) => (
  <div className="vibe-slider">
    <label className="slider-label">{label}</label>
    <div className="slider-container">
      <span className="slider-end-label">{leftLabel}</span>
      <input
        type="range"
        min="0"
        max="100"
        value={value * 100}
        onChange={(e) => onChange(e.target.value / 100)}
        className="slider"
      />
      <span className="slider-end-label">{rightLabel}</span>
    </div>
  </div>
);

const TimeSelector = ({ value, onChange }) => {
  const options = [
    { minutes: 60, label: "1 hour" },
    { minutes: 90, label: "90 min" },
    { minutes: 120, label: "2 hours" },
    { minutes: 180, label: "3 hours" },
    { minutes: 240, label: "half day" }
  ];
  
  return (
    <div className="time-selector">
      <label className="selector-label">Time you have</label>
      <div className="time-options">
        {options.map(opt => (
          <button
            key={opt.minutes}
            className={`time-option ${value === opt.minutes ? 'active' : ''}`}
            onClick={() => onChange(opt.minutes)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
};

const LocationSelector = ({ value, onChange }) => {
  const options = [
    { value: 'inside', label: 'Inside' },
    { value: 'outside', label: 'Outside' },
    { value: 'either', label: 'Either' }
  ];

  return (
    <div className="location-selector">
      <label className="selector-label">Location</label>
      <div className="radio-options">
        {options.map(opt => (
          <button
            key={opt.value}
            className={`radio-option ${value === opt.value ? 'active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
};

const TagSelector = ({ selectedTags, onChange }) => {
  const tags = [
    'dog-friendly',
    'food-focused',
    'kid-friendly',
    'date-night',
    'solo-friendly',
    'creative',
    'educational',
    'nature',
    'friend-hangout',
    'unusual-options',
    'outside-my-norm',
    'free',
    'cheap-eats'
  ];

  const toggleTag = (tag) => {
    if (selectedTags.includes(tag)) {
      onChange(selectedTags.filter(t => t !== tag));
    } else {
      onChange([...selectedTags, tag]);
    }
  };

  return (
    <div className="tag-selector">
      <label className="selector-label">Tags (select any that apply)</label>
      <div className="tag-options">
        {tags.map(tag => (
          <button
            key={tag}
            className={`tag-option ${selectedTags.includes(tag) ? 'active' : ''}`}
            onClick={() => toggleTag(tag)}
          >
            {tag}
          </button>
        ))}
      </div>
    </div>
  );
};

const DateTimeSelector = ({ value, onChange }) => {
  const [expanded, setExpanded] = useState(false);

  const formatDateTime = (date) => {
    if (!date) return 'Now';
    const d = new Date(date);
    const now = new Date();

    // Check if it's today
    if (d.toDateString() === now.toDateString()) {
      return 'Now';
    }

    // Format as "Mon, Jan 15, 3:00 PM"
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const handleDateChange = (e) => {
    const selectedDate = new Date(e.target.value);
    const now = new Date();
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 14); // 2 weeks from now

    if (selectedDate < now) {
      onChange(null); // Reset to "Now"
    } else if (selectedDate > maxDate) {
      onChange(maxDate.toISOString());
    } else {
      onChange(selectedDate.toISOString());
    }
  };

  const getMaxDate = () => {
    const max = new Date();
    max.setDate(max.getDate() + 14);
    return max.toISOString().slice(0, 16);
  };

  const getMinDate = () => {
    return new Date().toISOString().slice(0, 16);
  };

  return (
    <div className="datetime-selector">
      <label className="selector-label">When?</label>
      <div className="datetime-container">
        <button
          className={`datetime-display ${!value ? 'active' : ''}`}
          onClick={() => setExpanded(!expanded)}
        >
          {formatDateTime(value)}
          <span className="datetime-arrow">{expanded ? '▲' : '▼'}</span>
        </button>

        {expanded && (
          <div className="datetime-picker">
            <input
              type="datetime-local"
              value={value ? new Date(value).toISOString().slice(0, 16) : getMinDate()}
              onChange={handleDateChange}
              min={getMinDate()}
              max={getMaxDate()}
              className="datetime-input"
            />
            <button
              className="datetime-reset"
              onClick={() => {
                onChange(null);
                setExpanded(false);
              }}
            >
              Reset to Now
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const RecommendationCard = ({ place, index }) => {
  // Use Place ID if available for more accurate Google Maps links, fallback to coordinates
  const mapUrl = place.google_place_id
    ? `https://www.google.com/maps/place/?q=place_id:${place.google_place_id}`
    : `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;

  return (
    <article className="recommendation" style={{ '--delay': `${index * 0.15}s` }}>
      <header className="rec-header">
        <span className="rec-type">{place.type}</span>
        <span className="rec-walk">{place.walkMinutes} min walk</span>
      </header>
      
      <h2 className="rec-name">{place.name}</h2>
      <p className="rec-neighborhood">{place.neighborhood}</p>
      
      <p className="rec-story">{place.story}</p>
      
      <div className="rec-nudge">
        <p>{place.nudge}</p>
      </div>
      
      <footer className="rec-footer">
        <span className="rec-hours">{place.hours}</span>
        <a 
          href={mapUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="rec-map-link"
        >
          Open in Maps →
        </a>
      </footer>
    </article>
  );
};

const InputScreen = ({ onSubmit }) => {
  const [timeAvailable, setTimeAvailable] = useState(90);
  const [quietToLively, setQuietToLively] = useState(0.5);
  const [activeToRelaxing, setActiveToRelaxing] = useState(0.5);
  const [location, setLocation] = useState('either');
  const [selectedTags, setSelectedTags] = useState([]);
  const [dateTime, setDateTime] = useState(null); // null = "Now"

  // Apply atmospheric effect based on location selection
  useEffect(() => {
    document.body.classList.remove('atmosphere-inside', 'atmosphere-outside');

    if (location === 'inside') {
      document.body.classList.add('atmosphere-inside');
    } else if (location === 'outside') {
      document.body.classList.add('atmosphere-outside');
    }

    // Cleanup on unmount
    return () => {
      document.body.classList.remove('atmosphere-inside', 'atmosphere-outside');
    };
  }, [location]);

  const handleSubmit = () => {
    onSubmit({
      timeAvailable,
      quietToLively,
      activeToRelaxing,
      location,
      tags: selectedTags,
      date: dateTime || new Date().toISOString() // Send current time if "Now"
    });
  };

  return (
    <div className="input-screen">
      <header className="app-header">
        <h1 className="app-title">Discover Madison</h1>
        <p className="app-subtitle">Find your next intentional experience</p>
      </header>

      <div className="input-form">
        <TimeSelector value={timeAvailable} onChange={setTimeAvailable} />

        <div className="vibes-section">
          <VibeSlider
            label="Atmosphere"
            leftLabel="quiet"
            rightLabel="lively"
            value={quietToLively}
            onChange={setQuietToLively}
          />

          <VibeSlider
            label="Energy"
            leftLabel="relaxing"
            rightLabel="active"
            value={activeToRelaxing}
            onChange={setActiveToRelaxing}
          />
        </div>

        <LocationSelector value={location} onChange={setLocation} />

        <TagSelector selectedTags={selectedTags} onChange={setSelectedTags} />

        <DateTimeSelector value={dateTime} onChange={setDateTime} />

        <button className="find-button" onClick={handleSubmit}>
          Find something good
        </button>
      </div>

      <footer className="input-footer">
        <p>Three suggestions, max. No scrolling.</p>
      </footer>
    </div>
  );
};

const ResultsScreen = ({ recommendations, onBack }) => {
  const timeOfDay = getTimeOfDay();
  const greeting = {
    morning: "Good morning",
    afternoon: "This afternoon",
    evening: "This evening"
  }[timeOfDay];
  
  return (
    <div className="results-screen">
      <header className="results-header">
        <button className="back-button" onClick={onBack}>← Different mood</button>
        <p className="results-greeting">{greeting}, here's what fits:</p>
      </header>
      
      <div className="recommendations">
        {recommendations.length > 0 ? (
          recommendations.map((place, index) => (
            <RecommendationCard key={place.id} place={place} index={index} />
          ))
        ) : (
          <div className="no-results">
            <p>Nothing quite matches right now.</p>
            <p className="no-results-hint">Try loosening your constraints or extending your time.</p>
          </div>
        )}
      </div>
      
      <footer className="results-footer">
        <p className="results-cta">Pick one. Go now.</p>
      </footer>
    </div>
  );
};

function App() {
  const [screen, setScreen] = useState('input');
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [usingAPI, setUsingAPI] = useState(false);

  const handleSubmit = async (preferences) => {
    setLoading(true);

    try {
      // Try API first
      const apiResults = await getRecommendationsAPI(preferences);

      if (apiResults && apiResults.length > 0) {
        // Transform API response to match local format
        const transformedResults = apiResults.map(rec => ({
          id: rec.id,
          name: rec.title,
          type: rec.type,
          neighborhood: rec.neighborhood,
          vibe: {
            quiet: parseFloat(rec.vibe_quiet),
            inside: parseFloat(rec.vibe_inside)
          },
          bestTimes: rec.best_times || [],
          walkMinutes: rec.walk_minutes_from_center,
          story: rec.description,
          nudge: rec.nudge || 'Enjoy your visit!',
          tags: rec.tags || [],
          lat: parseFloat(rec.lat),
          lng: parseFloat(rec.lng),
          google_place_id: rec.google_place_id,
          hours: typeof rec.hours === 'string' ? rec.hours : 'Check website',
          kidFriendly: rec.kid_friendly,
          lowEnergy: rec.low_energy
        }));

        setRecommendations(transformedResults);
        setUsingAPI(true);
        console.log('✅ Using API recommendations');
      } else {
        // Fallback to local scoring
        const localResults = getRecommendations(preferences, 3);
        setRecommendations(localResults);
        setUsingAPI(false);
        console.log('⚠️ API unavailable, using local recommendations');
      }
    } catch (error) {
      // Fallback to local scoring on error
      console.warn('API error, falling back to local:', error);
      const localResults = getRecommendations(preferences, 3);
      setRecommendations(localResults);
      setUsingAPI(false);
    }

    setLoading(false);
    setScreen('results');
  };

  const handleBack = () => {
    setScreen('input');
    setRecommendations([]);
  };

  return (
    <div className="app">
      {screen === 'input' ? (
        <InputScreen onSubmit={handleSubmit} />
      ) : (
        <ResultsScreen
          recommendations={recommendations}
          onBack={handleBack}
          loading={loading}
          usingAPI={usingAPI}
        />
      )}
    </div>
  );
}

export default App;
