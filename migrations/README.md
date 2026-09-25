# Migrations

Run in numeric order against a fresh database. Each file is plain SQL:

```bash
psql "$POSTGRES_URL" < migrations/001_initial_schema.sql
```

## Renumbering (September 2026)

Several files used to share a number. They were renamed so the order is
unambiguous. **The SQL did not change**, so a database that already ran the old
files doesn't need to run anything again.

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

The recommendations API reads `seasons` and `best_times` straight from the
`places` table, so seasonal filtering works without changing the
`activities` view. It only needs `008_add_seasonal_filtering.sql` applied.
