/**
 * What this device remembers: picks seen lately, places you went, how it
 * was, and a short "Someday" list. Nothing here is sent anywhere except as
 * lists of ids that nudge ranking.
 *
 * Storage can be missing or throw (private windows, blocked site data), so
 * every read falls back to empty and every write is best-effort.
 */

const KEY = 'itf-history-v1';

export const SOMEDAY_LIMIT = 5;
const RECENT_SESSIONS = 3;
const ASK_AFTER_MS = 3 * 60 * 60 * 1000; // "Did you go?" once a few hours have passed
const FORGET_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // ...and never for something two weeks old

const empty = () => ({ sessions: [], went: [], someday: [] });

export function createHistory(storage = safeStorage()) {
  const load = () => {
    try {
      const data = JSON.parse(storage.getItem(KEY) || 'null');
      return data && typeof data === 'object' ? { ...empty(), ...data } : empty();
    } catch {
      return empty();
    }
  };
  const save = (data) => {
    try {
      storage.setItem(KEY, JSON.stringify(data));
    } catch {
      // Best-effort: the app works the same without memory
    }
  };
  const update = (fn) => {
    const data = load();
    fn(data);
    save(data);
    return data;
  };

  return {
    load,

    /** Remember the cards a person saw, as one session */
    recordShown(keys) {
      update(d => {
        d.sessions = [keys, ...d.sessions].slice(0, RECENT_SESSIONS);
      });
    },

    /** Tapped "Go": ask later how it went */
    recordGo(card, now = new Date()) {
      update(d => {
        d.went = [
          { key: card.key, title: card.title, at: now.toISOString(), verdict: null },
          ...d.went.filter(w => w.key !== card.key || w.verdict !== null),
        ].slice(0, 50);
      });
    },

    /** 'loved' | 'meh' | 'skipped' */
    recordVerdict(key, verdict) {
      update(d => {
        const entry = d.went.find(w => w.key === key && w.verdict === null);
        if (entry) entry.verdict = verdict;
      });
    },

    /** The oldest "Go" that's due a follow-up question, if any */
    pendingQuestion(now = new Date()) {
      const age = (w) => now.getTime() - new Date(w.at).getTime();
      return load().went
        .filter(w => w.verdict === null && age(w) >= ASK_AFTER_MS && age(w) <= FORGET_AFTER_MS)
        .sort((a, b) => new Date(a.at) - new Date(b.at))[0] || null;
    },

    /** Save for someday; the cap keeps it intentional. Returns false when full. */
    toggleSomeday(card) {
      let saved = true;
      update(d => {
        if (d.someday.some(s => s.key === card.key)) {
          d.someday = d.someday.filter(s => s.key !== card.key);
        } else if (d.someday.length >= SOMEDAY_LIMIT) {
          saved = false;
        } else {
          d.someday.push({ key: card.key, title: card.title, mapUrl: card.mapUrl });
        }
      });
      return saved;
    },

    /** What the API needs to steer away from repeats and misses */
    rankingHints() {
      const d = load();
      return {
        recent: [...new Set(d.sessions.flat())],
        disliked: d.went.filter(w => w.verdict === 'meh').map(w => w.key),
      };
    },
  };
}

function safeStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // Accessing localStorage itself can throw
  }
  const memory = new Map();
  return { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
}
