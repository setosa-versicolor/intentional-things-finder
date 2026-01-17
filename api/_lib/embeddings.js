/**
 * OpenAI Embeddings Utility
 * Generates vector embeddings for semantic search
 *
 * Cost: text-embedding-3-small is ~$0.02 per 1M tokens
 * - Average activity description: ~200 tokens
 * - 1000 activities ≈ 200k tokens = $0.004
 */

import dotenv from 'dotenv';
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generate embedding for a single text input
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - Vector embedding (1536 dimensions)
 */
export async function generateEmbedding(text) {
  if (!OPENAI_API_KEY) {
    console.warn('⚠️  OPENAI_API_KEY not set - skipping embedding generation');
    return null;
  }

  if (!text || text.trim().length === 0) {
    console.warn('⚠️  Empty text provided for embedding');
    return null;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.data[0].embedding;

  } catch (error) {
    console.error('❌ Embedding generation failed:', error.message);
    return null;
  }
}

/**
 * Generate embedding for an activity (place or event)
 * Creates a rich semantic representation from title, description, and tags
 *
 * @param {Object} activity - Activity object
 * @returns {Promise<number[]>} - Vector embedding
 */
export async function generateActivityEmbedding(activity) {
  // Build semantic text representation
  const parts = [];

  // Title is most important
  if (activity.title || activity.name) {
    parts.push(activity.title || activity.name);
  }

  // Description/story provides context
  if (activity.description) {
    parts.push(activity.description);
  } else if (activity.story) {
    parts.push(activity.story);
  }

  // Tags capture explicit attributes
  if (activity.tags && Array.isArray(activity.tags)) {
    const userTags = activity.tags.filter(t =>
      !['music', 'live-music', 'comedy', 'entertainment', 'art', 'culture',
        'theater', 'performing-arts', 'film', 'movies', 'food', 'drink',
        'family', 'kids', 'outdoors', 'nature', 'social', 'nightlife',
        'education', 'lectures', 'sports', 'fitness', 'general'].includes(t)
    );
    if (userTags.length > 0) {
      parts.push(`Tags: ${userTags.join(', ')}`);
    }
  }

  // Add vibe descriptors for richer semantic matching
  const vibes = [];
  if (activity.vibe_quiet !== undefined) {
    vibes.push(activity.vibe_quiet < 0.4 ? 'lively atmosphere' : 'quiet atmosphere');
  }
  if (activity.vibe_inside !== undefined) {
    vibes.push(activity.vibe_inside > 0.6 ? 'indoor space' : 'outdoor space');
  }
  if (activity.vibe_active !== undefined) {
    vibes.push(activity.vibe_active < 0.4 ? 'relaxing activity' : 'active experience');
  }
  if (vibes.length > 0) {
    parts.push(vibes.join(', '));
  }

  // Combine into semantic text
  const semanticText = parts.join('. ');

  return generateEmbedding(semanticText);
}

/**
 * Generate embedding for user preferences
 * Converts structured preferences into semantic query
 *
 * @param {Object} preferences - User preferences
 * @returns {Promise<number[]>} - Vector embedding
 */
export async function generatePreferenceEmbedding(preferences) {
  const parts = [];

  // Atmosphere
  if (preferences.quietToLively !== undefined) {
    if (preferences.quietToLively < 0.3) {
      parts.push('quiet, peaceful atmosphere');
    } else if (preferences.quietToLively > 0.7) {
      parts.push('lively, social atmosphere');
    } else {
      parts.push('moderate atmosphere');
    }
  }

  // Energy level
  if (preferences.activeToRelaxing !== undefined) {
    if (preferences.activeToRelaxing < 0.3) {
      parts.push('active, energetic experience');
    } else if (preferences.activeToRelaxing > 0.7) {
      parts.push('relaxing, low-energy activity');
    } else {
      parts.push('moderate energy activity');
    }
  }

  // Location
  if (preferences.location) {
    if (preferences.location === 'inside') {
      parts.push('indoor location');
    } else if (preferences.location === 'outside') {
      parts.push('outdoor location');
    }
  }

  // Tags (most specific)
  if (preferences.tags && preferences.tags.length > 0) {
    parts.push(`Looking for: ${preferences.tags.join(', ')}`);
  }

  const queryText = parts.join('. ');
  return generateEmbedding(queryText);
}

/**
 * Batch generate embeddings with rate limiting
 * OpenAI allows 3000 RPM for tier 1, but we'll be conservative
 *
 * @param {Array<string>} texts - Array of texts to embed
 * @param {number} delayMs - Delay between requests (default 100ms = 10 req/s)
 * @returns {Promise<Array<number[]>>} - Array of embeddings
 */
export async function batchGenerateEmbeddings(texts, delayMs = 100) {
  const embeddings = [];

  for (let i = 0; i < texts.length; i++) {
    console.log(`  Generating embedding ${i + 1}/${texts.length}...`);
    const embedding = await generateEmbedding(texts[i]);
    embeddings.push(embedding);

    // Rate limiting
    if (i < texts.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return embeddings;
}

/**
 * Check if activity already has an embedding
 * @param {Object} activity - Activity with optional embedding field
 * @returns {boolean}
 */
export function hasEmbedding(activity) {
  return activity.embedding !== null &&
         activity.embedding !== undefined &&
         (Array.isArray(activity.embedding) ? activity.embedding.length === EMBEDDING_DIMENSIONS : true);
}
