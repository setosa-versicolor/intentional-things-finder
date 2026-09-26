-- Read-only health check. Paste into a SQL editor (Supabase, Neon/Vercel) or:
--   psql "$POSTGRES_URL" -f scripts/sql/check-database.sql
--
-- Changes nothing. Works on a database at any migration level.
-- "last recommendation" shows whether the live app is writing here.

WITH col AS (
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = current_schema()
),
has AS (
  SELECT
    EXISTS (SELECT 1 FROM col WHERE table_name = 'places' AND column_name = 'vibe_active')     AS m003,
    EXISTS (SELECT 1 FROM col WHERE table_name = 'places' AND column_name = 'google_place_id') AS m005,
    EXISTS (SELECT 1 FROM col WHERE table_name = 'activities' AND column_name = 'google_place_id') AS m006,
    EXISTS (SELECT 1 FROM col WHERE table_name = 'places' AND column_name = 'business_status') AS m007,
    EXISTS (SELECT 1 FROM col WHERE table_name = 'places' AND column_name = 'seasons')         AS m008,
    to_regclass('activities') IS NOT NULL
      AND pg_get_viewdef('activities'::regclass) ILIKE '%coalesce(e.end_time%'                 AS m010,
    to_regclass('schema_migrations') IS NOT NULL                                               AS tracked
)
SELECT 'database' AS check, current_database() AS result
UNION ALL SELECT 'places (active)', (SELECT COUNT(*)::text FROM places WHERE is_active)
UNION ALL SELECT 'events (upcoming)', (SELECT COUNT(*)::text FROM events WHERE start_time > NOW())
UNION ALL SELECT 'latest event scraped', (SELECT MAX(created_at)::text FROM events)
UNION ALL SELECT 'recommendations logged', (SELECT COUNT(*)::text FROM recommendations)
UNION ALL SELECT 'last recommendation', (SELECT MAX(requested_at)::text FROM recommendations)
UNION ALL SELECT 'activities view exists', (to_regclass('activities') IS NOT NULL)::text
UNION ALL SELECT '003 vibe_active', (SELECT m003::text FROM has)
UNION ALL SELECT '005 google_place_id', (SELECT m005::text FROM has)
UNION ALL SELECT '006 view has place ids', (SELECT m006::text FROM has)
UNION ALL SELECT '007 business_status', (SELECT m007::text FROM has)
UNION ALL SELECT '008 seasons', (SELECT m008::text FROM has)
UNION ALL SELECT '010 running events in view', (SELECT m010::text FROM has)
UNION ALL SELECT 'schema_migrations table', (SELECT tracked::text FROM has);
