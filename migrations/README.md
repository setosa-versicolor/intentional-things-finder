# Migrations

Don't paste these into a SQL editor one by one. Use the runner:

```bash
node scripts/migrate.js            # dry run: what's applied, what would run
node scripts/migrate.js --apply    # run what's pending
```

It connects to `POSTGRES_URL` (or `DATABASE_URL`) and prints which host it's
talking to, never the password.

**Databases with an unknown history.** Applied migrations are recorded in a
`schema_migrations` table. Databases set up before that table existed are
checked against the schema instead: if `places.vibe_active` exists, 003 already
ran, and so on. Nothing runs twice, and hand-tuned data isn't overwritten.
Each pending migration runs in its own transaction. A failure rolls that
migration back and stops.

**Which database is which?** Paste `scripts/sql/check-database.sql` into each
database's SQL editor. It's read-only and shows place and event counts, when
the app last logged a recommendation, and which migrations are present.

## Renumbering (September 2026)

Several files used to share a number. They were renamed so the order is
unambiguous. **The SQL did not change**, and `scripts/migrate.js` recognizes
migrations applied under the old names.

| Current name | Previously |
|---|---|
| `001_initial_schema.sql` | `001_initial_schema 2.sql` |
| `002_seed_madison_places.sql` | (unchanged) |
| `003_add_vibe_active.sql` | (unchanged) |
| `004_update_place_tags.sql` | (unchanged) |
| `005_add_google_place_id.sql` | `002_add_google_place_id.sql` |
| `006_add_place_id_to_view.sql` | `003_add_place_id_to_view.sql` |
| `007_add_business_status.sql` | `004_add_business_status.sql` |
| `008_add_seasonal_filtering.sql` | `005_add_seasonal_filtering.sql` |
| `009_add_more_seasonal_restrictions.sql` | `006_add_more_seasonal_restrictions.sql` |
| `010_keep_running_events_in_view.sql` | (new) |
| `011_add_event_triage.sql` | (new) |

The recommendations API reads `seasons` and `best_times` straight from the
`places` table, so seasonal filtering works without changing the
`activities` view. It only needs `008_add_seasonal_filtering.sql` applied.
