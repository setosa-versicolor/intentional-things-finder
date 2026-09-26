-- Migration 011: Event triage
-- A model sorts scraped events: is this worth recommending, which tags and
-- vibes fit. Stored apart from the scraped fields so daily scrapes never
-- overwrite it. Nothing here is shown to users; it only affects ranking.

ALTER TABLE events ADD COLUMN IF NOT EXISTS triage JSONB;
ALTER TABLE events ADD COLUMN IF NOT EXISTS triage_hash TEXT;

COMMENT ON COLUMN events.triage IS 'Model sorting result: {score, reason, tags, vibe_quiet, vibe_inside, vibe_active, kid_friendly, is_free, model, triaged_at}';
COMMENT ON COLUMN events.triage_hash IS 'md5 of the text that was triaged; a mismatch means the event changed and needs triage again';
