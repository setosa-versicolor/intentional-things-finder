/**
 * API utilities for Intentional Things Finder
 * Connects React frontend to the recommendation API
 */

// In production (Vercel), use relative URLs (same domain as frontend)
// In development, use localhost:3001
const API_URL = import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? '' : 'http://localhost:3001');

/**
 * Get recommendations from the API
 * @param {Object} preferences - User preferences
 * @returns {Promise<Array>} - Array of recommendations
 */
export async function getRecommendations(preferences) {
  try {
    const response = await fetch(`${API_URL}/api/recommendations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preferences),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.recommendations;

  } catch (error) {
    console.error('Failed to fetch recommendations:', error);
    // Return null to allow fallback to local data
    return null;
  }
}

/**
 * Get details for a specific activity
 * @param {string} type - 'place' or 'event'
 * @param {number} id - Activity ID
 * @returns {Promise<Object>} - Activity details
 */
export async function getActivityDetails(type, id) {
  try {
    const response = await fetch(`${API_URL}/api/activities/${type}/${id}`);

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return await response.json();

  } catch (error) {
    console.error('Failed to fetch activity details:', error);
    return null;
  }
}

/**
 * Send feedback when user selects a recommendation
 * @param {number} recommendationId - ID from recommendation response
 * @param {number} selectedId - ID of selected activity
 * @param {string} selectedType - 'place' or 'event'
 * @param {number} rating - Optional rating 1-5
 */
export async function sendFeedback(recommendationId, selectedId, selectedType, rating = null) {
  try {
    const response = await fetch(`${API_URL}/api/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recommendationId,
        selectedId,
        selectedType,
        rating,
      }),
    });

    if (!response.ok) {
      console.warn('Failed to send feedback:', response.statusText);
    }

  } catch (error) {
    console.error('Failed to send feedback:', error);
    // Don't throw - feedback is non-critical
  }
}

/**
 * Check if API is available
 * @returns {Promise<boolean>}
 */
export async function checkAPIHealth() {
  try {
    const response = await fetch(`${API_URL}/api/health`, {
      method: 'GET',
    });

    return response.ok;

  } catch (error) {
    console.warn('API health check failed:', error);
    return false;
  }
}
