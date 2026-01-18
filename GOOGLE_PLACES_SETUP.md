# Google Places API Integration

This document explains how to set up and use the Google Places API integration to automatically fetch hours, ratings, and other details for places in the database.

## Why Google Places API?

- **Automated hours updates**: No more manually verifying hours
- **Always current**: Hours update when businesses update their Google listing
- **Rich metadata**: Also get ratings, reviews, phone numbers, websites
- **Better Maps links**: Use Place IDs for accurate Google Maps links

## Setup Instructions

### 1. Get a Google Places API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Places API** (New):
   - Navigate to **APIs & Services** > **Library**
   - Search for "Places API (New)"
   - Click **Enable**
4. Create credentials:
   - Navigate to **APIs & Services** > **Credentials**
   - Click **Create Credentials** > **API Key**
   - Copy the API key

**Important**: Restrict your API key to prevent unauthorized use:
- Under **API restrictions**, select "Restrict key"
- Choose "Places API (New)"
- Under **Application restrictions**, consider adding HTTP referrers for production

### 2. Add API Key to Environment

Add your API key to `.env.local`:

```bash
GOOGLE_PLACES_API_KEY=your_api_key_here
```

### 3. Run Database Migration

Apply the migration to add Google Places columns:

```bash
# Using psql (if available)
psql "$POSTGRES_URL" < migrations/002_add_google_place_id.sql

# Or using any PostgreSQL client, run the SQL in:
# migrations/002_add_google_place_id.sql
```

This adds the following columns to the `places` table:
- `google_place_id` - Google's unique place identifier
- `last_synced_at` - When we last synced from Google
- `google_rating` - Google Maps rating (1-5)
- `google_user_ratings_total` - Number of reviews

### 4. Sync Place Data

Run the sync script to fetch Place IDs and hours for all places:

```bash
# Sync all places that haven't been synced in the last 7 days
node scripts/sync-google-places.js

# Test with just 5 places first
node scripts/sync-google-places.js --limit=5

# Force re-sync all places
node scripts/sync-google-places.js --all
```

The script will:
1. Look up Google Place IDs for places that don't have them
2. Fetch current hours from Google
3. Update ratings, phone numbers, and websites
4. Store everything in the database

### 5. Schedule Regular Updates

To keep hours current, schedule the sync script to run regularly (e.g., weekly):

```bash
# Cron job to sync every Monday at 3am
0 3 * * 1 cd /path/to/project && node scripts/sync-google-places.js
```

Or use a service like GitHub Actions, Vercel Cron, or Railway Cron.

## How It Works

### Place ID Lookup

The script uses the [Find Place API](https://developers.google.com/maps/documentation/places/web-service/search-find-place) to find Google's Place ID for each location:

```javascript
import { findPlaceId } from './api/_lib/google-places.js';

const result = await findPlaceId(
  "Bradbury's Coffee",
  "Capitol Square, Madison, WI",
  43.0747,  // latitude
  -89.3882  // longitude
);
// Returns: { place_id: "ChIJ...", name: "Bradbury's Coffee", address: "..." }
```

### Fetching Place Details

Once we have a Place ID, we fetch detailed information using the [Place Details API](https://developers.google.com/maps/documentation/places/web-service/details):

```javascript
import { getPlaceDetails, formatHours } from './api/_lib/google-places.js';

const details = await getPlaceDetails(placeId);
const hours = formatHours(details.opening_hours);
// Stores formatted hours in database
```

### Hours Format

Hours are stored in the `hours` JSONB column in this format:

```json
{
  "type": "standard",
  "always_open": false,
  "periods": [
    {
      "open": { "day": 1, "time": "0700" },
      "close": { "day": 1, "time": "1800" }
    }
  ],
  "weekday_text": [
    "Monday: 7:00 AM – 6:00 PM",
    "Tuesday: 7:00 AM – 6:00 PM",
    ...
  ]
}
```

For 24/7 places:
```json
{
  "type": "always_open",
  "always_open": true,
  "text": "Open 24 hours"
}
```

## Using Place IDs in the UI

Update Google Maps links to use Place IDs instead of coordinates:

```javascript
// Before (less accurate):
const mapUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

// After (more accurate):
const mapUrl = place.google_place_id
  ? `https://www.google.com/maps/place/?q=place_id:${place.google_place_id}`
  : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
```

## API Costs

Google Places API pricing (as of 2024):
- **Find Place**: $0.017 per request (for Place ID lookup)
- **Place Details**: $0.017 per request (for hours, ratings, etc.)

For 200 places synced weekly:
- Initial sync: 200 lookups + 200 details = 400 requests = ~$7
- Weekly updates: 200 details requests = ~$3.40/week = ~$14/month

Google provides $200/month free credit, so this should be covered.

## Troubleshooting

### "GOOGLE_PLACES_API_KEY not set"
- Make sure you added the key to `.env.local`
- Restart your terminal/server after adding the key

### "REQUEST_DENIED" or "API key not valid"
- Check that the Places API (New) is enabled in Google Cloud Console
- Verify your API key is correct
- Check API restrictions aren't blocking the request

### "ZERO_RESULTS" for a place
- The place name or address might be incorrect
- Try adding more specific location info (full address)
- Manually search on Google Maps to verify the place exists

### Rate limiting
- The script includes 200ms delays between requests
- For large syncs, consider increasing the delay or running in batches

## Next Steps

1. Run the migration to add the new columns
2. Add your Google Places API key to `.env.local`
3. Test with a few places: `node scripts/sync-google-places.js --limit=5`
4. Sync all places: `node scripts/sync-google-places.js`
5. Update the UI to use Place IDs in Maps links
6. Schedule weekly syncs to keep hours current
