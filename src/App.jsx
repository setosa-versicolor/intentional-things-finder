import React, { useState, useEffect } from 'react';
import './App.css';
import { getRecommendations as getRecommendationsAPI, sendFeedback } from './api';
import { buildContext, rankActivities } from '../api/_lib/recommend.js';
import { FALLBACK_PLACES } from './fallbackPlaces.js';
import { toCard, greetingFor } from './cards.js';

// Offline fallback: same ranking as the API, over a handful of favorites
const getFallbackRecommendations = (preferences, date, count = 3) =>
  rankActivities(FALLBACK_PLACES, preferences, buildContext({ date }), count);

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
        aria-label={`${label}: ${leftLabel} to ${rightLabel}`}
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
            type="button"
            aria-pressed={value === opt.minutes}
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
            type="button"
            aria-pressed={value === opt.value}
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
            type="button"
            aria-pressed={selectedTags.includes(tag)}
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

// datetime-local inputs work in local time, not UTC
const toLocalInputValue = (date) => {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const MAX_DAYS_AHEAD = 14;

const DateTimeSelector = ({ value, onChange }) => {
  const [expanded, setExpanded] = useState(false);

  const formatDateTime = (date) => {
    if (!date) return 'Now';

    // Format as "Mon, Jan 15, 3:00 PM"
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const getMaxDate = () => {
    const max = new Date();
    max.setDate(max.getDate() + MAX_DAYS_AHEAD);
    return max;
  };

  const handleDateChange = (e) => {
    if (!e.target.value) return;
    const selectedDate = new Date(e.target.value); // parsed as local time
    const maxDate = getMaxDate();

    if (selectedDate <= new Date()) {
      onChange(null); // Reset to "Now"
    } else if (selectedDate > maxDate) {
      onChange(maxDate.toISOString());
    } else {
      onChange(selectedDate.toISOString());
    }
  };

  return (
    <div className="datetime-selector">
      <label className="selector-label">When?</label>
      <div className="datetime-container">
        <button
          type="button"
          aria-expanded={expanded}
          className={`datetime-display ${!value ? 'active' : ''}`}
          onClick={() => setExpanded(!expanded)}
        >
          {formatDateTime(value)}
          <span className="datetime-arrow" aria-hidden="true">{expanded ? '▲' : '▼'}</span>
        </button>

        {expanded && (
          <div className="datetime-picker">
            <input
              type="datetime-local"
              aria-label="Start time"
              value={toLocalInputValue(value || new Date())}
              onChange={handleDateChange}
              min={toLocalInputValue(new Date())}
              max={toLocalInputValue(getMaxDate())}
              className="datetime-input"
            />
            <button
              type="button"
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

const RecommendationCard = ({ card, index, onGo }) => (
  <article className="recommendation" style={{ '--delay': `${index * 0.15}s` }}>
    <header className="rec-header">
      <span className="rec-type">{card.label}</span>
      {card.walkMinutes !== null && (
        <span className="rec-walk">{card.walkMinutes} min walk from the Square</span>
      )}
    </header>

    <h2 className="rec-name">{card.title}</h2>
    {card.neighborhood && <p className="rec-neighborhood">{card.neighborhood}</p>}

    {card.story && <p className="rec-story">{card.story}</p>}

    {card.nudge && (
      <div className="rec-nudge">
        <p>{card.nudge}</p>
      </div>
    )}

    <footer className="rec-footer">
      <span className="rec-hours">{card.when || ''}</span>
      <span className="rec-links">
        {card.detailsUrl && (
          <a
            href={card.detailsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rec-map-link"
            onClick={() => onGo(card)}
          >
            Details
          </a>
        )}
        <a
          href={card.mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rec-map-link"
          onClick={() => onGo(card)}
        >
          Open in Maps →
        </a>
      </span>
    </footer>
  </article>
);

const InputScreen = ({ onSubmit, loading }) => {
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
    if (loading) return;
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

        <button
          type="button"
          className="find-button"
          onClick={handleSubmit}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? 'Finding something good…' : 'Find something good'}
        </button>
      </div>

      <footer className="input-footer">
        <p>Three suggestions, max. No scrolling.</p>
      </footer>
    </div>
  );
};

const ResultsScreen = ({ recommendations, requestedDate, usingFallback, onBack, onGo }) => {
  const now = new Date();
  const greeting = greetingFor(requestedDate, now);
  const cards = recommendations.map(rec => toCard(rec, { requestedDate, now }));

  return (
    <div className="results-screen">
      <header className="results-header">
        <button type="button" className="back-button" onClick={onBack}>← Different mood</button>
        <p className="results-greeting">{greeting}, here's what fits:</p>
        {usingFallback && (
          <p className="results-notice">
            Couldn't reach the full list just now, so here are a few old favorites.
          </p>
        )}
      </header>

      <div className="recommendations">
        {cards.length > 0 ? (
          cards.map((card, index) => (
            <RecommendationCard key={card.key} card={card} index={index} onGo={onGo} />
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
  const [recommendationId, setRecommendationId] = useState(null);
  const [requestedDate, setRequestedDate] = useState(() => new Date());
  const [loading, setLoading] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  const handleSubmit = async (preferences) => {
    setLoading(true);
    const date = new Date(preferences.date);

    // Returns null if the API is unreachable
    const response = await getRecommendationsAPI(preferences);

    if (response) {
      setRecommendations(response.recommendations || []);
      setRecommendationId(response.metadata?.recommendationId ?? null);
      setRequestedDate(response.metadata?.requestedAt ? new Date(response.metadata.requestedAt) : date);
      setUsingFallback(false);
    } else {
      setRecommendations(getFallbackRecommendations(preferences, date));
      setRecommendationId(null);
      setRequestedDate(date);
      setUsingFallback(true);
    }

    setLoading(false);
    setScreen('results');
  };

  const handleGo = (card) => {
    if (recommendationId) {
      sendFeedback(recommendationId, card.id, card.type);
    }
  };

  const handleBack = () => {
    setScreen('input');
    setRecommendations([]);
    setRecommendationId(null);
  };

  return (
    <div className="app">
      {screen === 'input' ? (
        <InputScreen onSubmit={handleSubmit} loading={loading} />
      ) : (
        <ResultsScreen
          recommendations={recommendations}
          requestedDate={requestedDate}
          usingFallback={usingFallback}
          onBack={handleBack}
          onGo={handleGo}
        />
      )}
    </div>
  );
}

export default App;
