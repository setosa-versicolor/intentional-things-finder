/**
 * Google Places API Helper
 *
 * Provides functions to:
 * - Find Place IDs by name and location
 * - Fetch place details including hours
 * - Format hours for storage
 */

const GOOGLE_PLACES_API_KEY = () => process.env.GOOGLE_PLACES_API_KEY;

/**
 * Search for a place and return its Place ID
 * Uses the new Places API (searchText)
 * @param {string} name - Place name
 * @param {string} address - Optional address or neighborhood
 * @param {number} lat - Optional latitude for better results
 * @param {number} lng - Optional longitude for better results
 * @returns {Promise<{place_id: string, name: string, address: string} | null>}
 */
export async function findPlaceId(name, address = '', lat = null, lng = null) {
  const apiKey = GOOGLE_PLACES_API_KEY();

  if (!apiKey) {
    console.warn('⚠️  GOOGLE_PLACES_API_KEY not set - skipping Place ID lookup');
    return null;
  }

  try {
    // Build search query
    const query = address ? `${name}, ${address}` : name;

    // Use new Places API (Text Search)
    const url = 'https://places.googleapis.com/v1/places:searchText';

    const requestBody = {
      textQuery: query,
      maxResultCount: 1
    };

    // Add location bias if we have coordinates
    if (lat && lng) {
      requestBody.locationBias = {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 5000.0
        }
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (data.places && data.places.length > 0) {
      const place = data.places[0];
      return {
        place_id: place.id,
        name: place.displayName?.text || name,
        address: place.formattedAddress,
        lat: place.location?.latitude,
        lng: place.location?.longitude
      };
    } else {
      console.log(`   No results found for "${query}"`);
      return null;
    }
  } catch (error) {
    console.error(`   Error finding place ID for "${name}":`, error.message);
    return null;
  }
}

/**
 * Fetch detailed information about a place using its Place ID
 * Uses the new Places API (Place Details)
 * @param {string} placeId - Google Place ID (format: "places/ChIJ...")
 * @returns {Promise<Object | null>} Place details including hours
 */
export async function getPlaceDetails(placeId) {
  const apiKey = GOOGLE_PLACES_API_KEY();

  if (!apiKey) {
    console.warn('⚠️  GOOGLE_PLACES_API_KEY not set - skipping place details');
    return null;
  }

  try {
    // New API uses format "places/ChIJ..." but placeId might be just "ChIJ..."
    const formattedPlaceId = placeId.startsWith('places/') ? placeId : `places/${placeId}`;

    const url = `https://places.googleapis.com/v1/${formattedPlaceId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'displayName,formattedAddress,internationalPhoneNumber,websiteUri,regularOpeningHours,rating,userRatingCount,location,priceLevel,businessStatus'
      }
    });

    const data = await response.json();

    if (data.displayName) {
      // Convert new API format to match old format for compatibility
      return {
        name: data.displayName?.text,
        formatted_address: data.formattedAddress,
        formatted_phone_number: data.internationalPhoneNumber,
        website: data.websiteUri,
        opening_hours: data.regularOpeningHours ? {
          open_now: data.regularOpeningHours.openNow,
          periods: data.regularOpeningHours.periods,
          weekday_text: data.regularOpeningHours.weekdayDescriptions
        } : null,
        rating: data.rating,
        user_ratings_total: data.userRatingCount,
        geometry: data.location ? {
          location: {
            lat: data.location.latitude,
            lng: data.location.longitude
          }
        } : null,
        price_level: data.priceLevel,
        business_status: data.businessStatus || 'OPERATIONAL'
      };
    } else {
      console.error(`   Could not fetch place details`);
      return null;
    }
  } catch (error) {
    console.error(`   Error fetching place details:`, error.message);
    return null;
  }
}

/**
 * Format Google opening hours into our database format
 * @param {Object} opening_hours - opening_hours object from Google Places API
 * @returns {Object} Formatted hours object
 */
export function formatHours(opening_hours) {
  if (!opening_hours || !opening_hours.periods) {
    return {
      type: 'unknown',
      always_open: false,
      periods: []
    };
  }

  // Check if always open (24/7)
  if (opening_hours.periods.length === 1 && !opening_hours.periods[0].close) {
    return {
      type: 'always_open',
      always_open: true,
      text: 'Open 24 hours'
    };
  }

  // Convert periods to our format
  const periods = opening_hours.periods.map(period => ({
    open: {
      day: period.open.day, // 0=Sunday, 1=Monday, etc.
      time: period.open.time // 24-hour format, e.g., "0900"
    },
    close: period.close ? {
      day: period.close.day,
      time: period.close.time
    } : null
  }));

  return {
    type: 'standard',
    always_open: false,
    periods: periods,
    weekday_text: opening_hours.weekday_text || []
  };
}

/**
 * Get a human-readable summary of hours
 * @param {Object} hours - Hours object from formatHours()
 * @returns {string} Human-readable hours summary
 */
export function getHoursSummary(hours) {
  if (!hours) return 'Hours not available';
  if (hours.always_open) return 'Open 24 hours';
  if (hours.weekday_text && hours.weekday_text.length > 0) {
    // Return a compact version - just Monday if they're all the same
    const firstDay = hours.weekday_text[0];
    const allSame = hours.weekday_text.every(day => day.includes(firstDay.split(': ')[1]));

    if (allSame) {
      return firstDay.split(': ')[1];
    }

    // Otherwise show first and last
    return `${hours.weekday_text[0].split(': ')[1]} (varies)`;
  }
  return 'See Google Maps for hours';
}

/**
 * Batch lookup Place IDs for multiple places
 * @param {Array<{name: string, address: string, lat: number, lng: number}>} places
 * @param {number} delayMs - Delay between requests to avoid rate limiting
 * @returns {Promise<Array>} Array of results
 */
export async function batchFindPlaceIds(places, delayMs = 200) {
  const results = [];

  for (const place of places) {
    console.log(`Looking up: ${place.name}`);
    const result = await findPlaceId(place.name, place.address, place.lat, place.lng);
    results.push({
      original: place,
      result: result
    });

    // Delay to avoid rate limiting
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
