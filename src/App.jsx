import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import './App.css';
import { getRecommendations as getRecommendationsAPI, sendFeedback } from './api';
import { buildContext, recommend } from '../api/_lib/recommend.js';
import { TAG_OPTIONS } from '../api/_lib/tags.js';
import { FALLBACK_PLACES } from './fallbackPlaces.js';
import { toCard, greetingFor, describeConditions } from './cards.js';
import { getSunTimes } from '../api/_lib/sun.js';
import { MOODS, DURATIONS, DEFAULT_PREFERENCES, preferencesForMood, minutesFor, startOptions } from './moods.js';
import { createHistory, SOMEDAY_LIMIT } from './history.js';

const history = createHistory();

// Offline fallback: same ranking as the API, over a handful of favorites
const getFallbackRecommendations = (request, date) =>
  recommend(FALLBACK_PLACES, request, buildContext({ date }), {
    count: request.limit || 3,
    role: request.role,
    avoidCategories: request.avoidCategories,
  });

const LOADING_LINES = [
  'Asking a Willy Street regular…',
  'Checking whether the Terrace chairs are out…',
  'Consulting the Capitol squirrels…',
  'Reading the lake…',
];

// ---------------------------------------------------------------------------
// Where you are (optional; asked for only when you tap the button)
// ---------------------------------------------------------------------------

function useLocation() {
  const [origin, setOrigin] = useState(null);
  const [status, setStatus] = useState('checking'); // checking | off | asking | on | denied | unavailable

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus('unavailable');
      return;
    }
    setStatus('asking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus('on');
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { maximumAge: 10 * 60 * 1000, timeout: 10000 }
    );
  }, []);

  // Already allowed on an earlier visit: use it without asking again
  useEffect(() => {
    let cancelled = false;
    const check = navigator.permissions?.query({ name: 'geolocation' });
    if (!check) {
      setStatus('off');
      return;
    }
    check
      .then(result => {
        if (cancelled) return;
        if (result.state === 'granted') locate();
        else setStatus('off');
      })
      .catch(() => !cancelled && setStatus('off'));
    return () => { cancelled = true; };
  }, [locate]);

  return { origin, status, locate };
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

const ChipGroup = ({ label, options, value, onChange, className = '' }) => (
  <div className={`chip-group ${className}`} role="group" aria-label={label}>
    {options.map(opt => (
      <button
        key={opt.id}
        type="button"
        aria-pressed={value === opt.id}
        className={`chip ${value === opt.id ? 'active' : ''}`}
        onClick={() => onChange(value === opt.id ? null : opt.id)}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

const VibeSlider = ({ label, leftLabel, rightLabel, value, onChange }) => {
  const describe = (v) => (v < 0.34 ? leftLabel : v > 0.66 ? rightLabel : 'in between');
  return (
    <div className="vibe-slider">
      <label className="slider-label">{label}</label>
      <div className="slider-container">
        <span className="slider-end-label" aria-hidden="true">{leftLabel}</span>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(value * 100)}
          onChange={(e) => onChange(e.target.value / 100)}
          aria-label={label}
          aria-valuetext={describe(value)}
          className="slider"
        />
        <span className="slider-end-label" aria-hidden="true">{rightLabel}</span>
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

const TuneDrawer = ({ prefs, onPrefs, customDate, onCustomDate }) => {
  const set = (patch) => onPrefs({ ...prefs, ...patch });
  const toggleTag = (tag) => set({
    tags: prefs.tags.includes(tag) ? prefs.tags.filter(t => t !== tag) : [...prefs.tags, tag],
  });
  const maxDate = new Date(Date.now() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000);

  return (
    <details className="tune">
      <summary>Tune it</summary>
      <div className="tune-body">
        <div className="vibes-section">
          <VibeSlider label="Atmosphere" leftLabel="quiet" rightLabel="lively"
            value={prefs.quietToLively} onChange={v => set({ quietToLively: v })} />
          <VibeSlider label="Energy" leftLabel="relaxing" rightLabel="active"
            value={prefs.activeToRelaxing} onChange={v => set({ activeToRelaxing: v })} />
        </div>

        <div className="tune-row">
          <span className="selector-label">Inside or out</span>
          <ChipGroup
            label="Inside or out"
            options={[{ id: 'inside', label: 'Inside' }, { id: 'outside', label: 'Outside' }]}
            value={prefs.location === 'either' ? null : prefs.location}
            onChange={v => set({ location: v || 'either' })}
          />
        </div>

        <div className="tune-row">
          <span className="selector-label">Good for</span>
          <div className="chip-group" role="group" aria-label="Good for">
            {TAG_OPTIONS.map(({ tag, label }) => (
              <button key={tag} type="button" aria-pressed={prefs.tags.includes(tag)}
                className={`chip chip-soft ${prefs.tags.includes(tag) ? 'active' : ''}`}
                onClick={() => toggleTag(tag)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="tune-row">
          <label className="selector-label" htmlFor="custom-date">A specific time</label>
          <div className="datetime-row">
            <input
              id="custom-date"
              type="datetime-local"
              className="datetime-input"
              value={customDate ? toLocalInputValue(customDate) : ''}
              min={toLocalInputValue(new Date())}
              max={toLocalInputValue(maxDate)}
              onChange={(e) => {
                if (!e.target.value) return onCustomDate(null);
                const picked = new Date(e.target.value);
                onCustomDate(picked <= new Date() ? null : picked > maxDate ? maxDate : picked);
              }}
            />
            {customDate && (
              <button type="button" className="text-button" onClick={() => onCustomDate(null)}>Clear</button>
            )}
          </div>
        </div>
      </div>
    </details>
  );
};

const RecommendationCard = ({ card, index, saved, swapping, onGo, onSwap, onSave, onShare }) => (
  <article className={`recommendation ${swapping ? 'is-swapping' : ''}`} style={{ '--delay': `${index * 0.12}s` }}
    aria-labelledby={`rec-${card.key}`}>
    <header className="rec-header">
      <span className="rec-role">{card.roleLabel || card.label}</span>
      {card.roleLabel && <span className="rec-type">{card.label}</span>}
    </header>

    <h2 className="rec-name" id={`rec-${card.key}`}>{card.title}</h2>
    {card.neighborhood && <p className="rec-neighborhood">{card.neighborhood}</p>}
    {card.status && <p className="rec-status">{card.status}</p>}

    {card.chips.length > 0 && (
      <ul className="rec-chips" aria-label="Right now">
        {card.chips.map(chip => <li key={chip}>{chip}</li>)}
      </ul>
    )}

    {card.story && <p className="rec-story">{card.story}</p>}
    {card.nudge && (
      <div className="rec-nudge">
        <p>{card.nudge}</p>
      </div>
    )}

    <footer className="rec-actions">
      <a className="action action-go" href={card.mapUrl} target="_blank" rel="noopener noreferrer"
        onClick={() => onGo(card)}>
        Go <span aria-hidden="true">→</span>
      </a>
      <button type="button" className="action" onClick={() => onSwap(card)} disabled={swapping}
        aria-label={`Swap ${card.title} for something else`}>
        {swapping ? 'Swapping…' : 'Swap'}
      </button>
      <button type="button" className="action" aria-pressed={saved} onClick={() => onSave(card)}>
        {saved ? 'Saved' : 'Save'}
      </button>
      <button type="button" className="action" onClick={() => onShare(card)}>Share</button>
      {card.detailsUrl && (
        <a className="action" href={card.detailsUrl} target="_blank" rel="noopener noreferrer">Details</a>
      )}
    </footer>
  </article>
);

const DidYouGo = ({ entry, onAnswer }) => (
  <section className="ask-banner" aria-label="How did it go?">
    <p>Did you make it to <strong>{entry.title}</strong>?</p>
    <div className="ask-actions">
      <button type="button" className="chip" onClick={() => onAnswer('loved')}>
        <span aria-hidden="true">👍</span> Loved it
      </button>
      <button type="button" className="chip" onClick={() => onAnswer('meh')}>
        <span aria-hidden="true">😐</span> It was fine
      </button>
      <button type="button" className="chip" onClick={() => onAnswer('skipped')}>Didn't go</button>
    </div>
  </section>
);

// ---------------------------------------------------------------------------
// The app: picks for right now on open, refine if you want to
// ---------------------------------------------------------------------------

function App() {
  const { origin, status: locationStatus, locate } = useLocation();

  const [mood, setMood] = useState(null);
  const [prefs, setPrefs] = useState(DEFAULT_PREFERENCES);
  const [duration, setDuration] = useState('2h');
  const [start, setStart] = useState('now');
  const [customDate, setCustomDate] = useState(null);

  const [picks, setPicks] = useState([]);
  const [meta, setMeta] = useState({ requestedDate: new Date(), conditions: null, recommendationId: null });
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);
  const [swapping, setSwapping] = useState(null);
  const [swappedAway, setSwappedAway] = useState([]);
  const [notice, setNotice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [question, setQuestion] = useState(() => history.pendingQuestion());
  const [someday, setSomeday] = useState(() => history.load().someday);
  const [loadingLine] = useState(() => LOADING_LINES[Math.floor(Math.random() * LOADING_LINES.length)]);

  const starts = useMemo(() => startOptions(new Date()), []);
  const startDate = customDate || starts.find(s => s.id === start)?.date || null;

  // One request shape for full refreshes and single-card swaps
  const baseRequest = useCallback((date) => ({
    ...prefs,
    timeAvailable: minutesFor(duration, date),
    date: date.toISOString(),
    origin,
    ...history.rankingHints(),
  }), [prefs, duration, origin]);

  const fetchPicks = useCallback(async (request, date) => {
    const response = await getRecommendationsAPI(request);
    if (response) return { response, fallback: false };
    return {
      response: {
        recommendations: getFallbackRecommendations(request, date),
        metadata: { conditions: { sunset: getSunTimes(date).sunset.toISOString() } },
      },
      fallback: true,
    };
  }, []);

  // Refresh whenever a choice changes (after location has had a moment to resolve)
  const requestId = useRef(0);
  useEffect(() => {
    if (locationStatus === 'checking' || locationStatus === 'asking') return undefined;
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      const date = startDate || new Date();
      const { response, fallback } = await fetchPicks(baseRequest(date), date);
      if (id !== requestId.current) return; // a newer request superseded this one

      const recs = response.recommendations || [];
      setPicks(recs);
      setSwappedAway([]);
      setMeta({
        requestedDate: response.metadata?.requestedAt ? new Date(response.metadata.requestedAt) : date,
        conditions: response.metadata?.conditions ?? null,
        recommendationId: response.metadata?.recommendationId ?? null,
      });
      setUsingFallback(fallback);
      setLoading(false);
      setAnnouncement(recs.length ? `${recs.length} new ideas: ${recs.map(r => r.title).join(', ')}` : 'Nothing fits right now');
      history.recordShown(recs.map(r => `${r.type}-${r.id}`));
    }, 250);
    return () => clearTimeout(timer);
  }, [baseRequest, fetchPicks, startDate, locationStatus]);

  const now = new Date();
  const cards = picks.map(rec => toCard(rec, { requestedDate: meta.requestedDate, now, conditions: meta.conditions }));
  const flash = (text) => {
    setNotice(text);
    setTimeout(() => setNotice(n => (n === text ? '' : n)), 4000);
  };

  const chooseMood = (id) => {
    setMood(id);
    setPrefs(id ? preferencesForMood(id) : DEFAULT_PREFERENCES);
  };

  const tunePrefs = (next) => {
    setMood(null); // hand-tuned now
    setPrefs(next);
  };

  const handleGo = (card) => {
    history.recordGo(card);
    if (meta.recommendationId) sendFeedback(meta.recommendationId, card.id, card.type);
  };

  const handleSwap = async (card) => {
    setSwapping(card.key);
    const date = meta.requestedDate;
    const away = [...swappedAway, card.key];
    const others = cards.filter(c => c.key !== card.key);
    const { response } = await fetchPicks({
      ...baseRequest(date),
      limit: 1,
      role: card.role,
      exclude: [...cards.map(c => c.key), ...away],
      avoidCategories: others.map(c => c.category),
    }, date);
    const [replacement] = response.recommendations || [];
    setSwapping(null);
    if (!replacement) {
      flash("That's the last good idea for this slot. Try another mood?");
      return;
    }
    setSwappedAway(away);
    setPicks(current => current.map(p => (`${p.type}-${p.id}` === card.key ? replacement : p)));
    setAnnouncement(`Swapped for ${replacement.title}`);
  };

  const handleSave = (card) => {
    if (!history.toggleSomeday(card)) {
      flash(`Someday holds ${SOMEDAY_LIMIT}. Do one of those first.`);
      return;
    }
    setSomeday(history.load().someday);
  };

  const handleShare = async (card) => {
    const text = `${card.shareText}\n${card.mapUrl}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: card.title, text: card.shareText, url: card.mapUrl });
      } else {
        await navigator.clipboard.writeText(text);
        flash('Copied. Send it to someone.');
      }
    } catch (err) {
      if (err?.name !== 'AbortError') flash("Couldn't share that one.");
    }
  };

  const answerQuestion = (verdict) => {
    history.recordVerdict(question.key, verdict);
    setQuestion(history.pendingQuestion());
    flash(verdict === 'loved' ? 'Noted. More like that.' : verdict === 'meh' ? "Noted. We'll steer elsewhere." : 'Next time.');
  };

  const greeting = greetingFor(meta.requestedDate, now);
  const conditionsLine = describeConditions(meta.conditions, meta.requestedDate);
  const savedKeys = new Set(someday.map(s => s.key));

  return (
    <main className="app">
      <header className="home-header">
        <p className="eyebrow">Discover Madison</p>
        <h1 className="home-greeting">{greeting}. Three ideas:</h1>
        {conditionsLine && <p className="results-conditions">{conditionsLine}</p>}
        <p className="location-line">
          {locationStatus === 'on' && 'Times are from where you are.'}
          {(locationStatus === 'off' || locationStatus === 'unavailable') && (
            <button type="button" className="text-button" onClick={locate}>
              Use my location for real walking times
            </button>
          )}
          {locationStatus === 'asking' && 'Finding you…'}
          {locationStatus === 'denied' && 'Location is off, so times are from the Capitol.'}
        </p>
      </header>

      {question && <DidYouGo entry={question} onAnswer={answerQuestion} />}

      <section className="controls" aria-label="What are you in the mood for?">
        <ChipGroup label="Mood" options={MOODS} value={mood} onChange={chooseMood} className="moods" />
        <div className="time-dial">
          <span className="dial-word">I have</span>
          <ChipGroup label="How long" options={DURATIONS} value={duration} onChange={v => setDuration(v || '2h')} />
          {!customDate && (
            <>
              <span className="dial-word">starting</span>
              <ChipGroup label="Starting" options={starts} value={start} onChange={v => setStart(v || 'now')} />
            </>
          )}
        </div>
      </section>

      <p className="sr-only" aria-live="polite">{announcement}</p>
      {notice && <p className="notice" role="status">{notice}</p>}
      {usingFallback && (
        <p className="results-notice">Couldn't reach the full list just now, so here are a few old favorites.</p>
      )}

      <section className={`recommendations ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
        {loading && <p className="loading-line">{loadingLine}</p>}
        {!loading && cards.length === 0 && (
          <div className="no-results">
            <p>Honestly? Go home and read.</p>
            <p className="no-results-hint">Or give yourself a longer window, or try another mood.</p>
          </div>
        )}
        {cards.map((card, index) => (
          <RecommendationCard
            key={card.key}
            card={card}
            index={index}
            saved={savedKeys.has(card.key)}
            swapping={swapping === card.key}
            onGo={handleGo}
            onSwap={handleSwap}
            onSave={handleSave}
            onShare={handleShare}
          />
        ))}
      </section>

      <TuneDrawer prefs={prefs} onPrefs={tunePrefs} customDate={customDate} onCustomDate={setCustomDate} />

      {someday.length > 0 && (
        <details className="someday">
          <summary>Someday ({someday.length}/{SOMEDAY_LIMIT})</summary>
          <ul>
            {someday.map(s => (
              <li key={s.key}>
                <a href={s.mapUrl} target="_blank" rel="noopener noreferrer">{s.title}</a>
                <button type="button" className="text-button" onClick={() => handleSave(s)}
                  aria-label={`Remove ${s.title} from Someday`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <footer className="input-footer">
        <p>Three suggestions, max. No scrolling.</p>
      </footer>
    </main>
  );
}

export default App;
