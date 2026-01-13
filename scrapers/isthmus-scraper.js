/**
 * Isthmus Calendar Event Scraper
 *
 * Scrapes events from https://isthmus.com/search/event/calendar-of-events
 * Extracts structured data from JSON-LD embedded in the page
 */

import puppeteer from 'puppeteer';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Category mapping from Isthmus to our taxonomy
const CATEGORY_MAPPING = {
  'Music': ['music', 'live-music'],
  'Dancing': ['music', 'social', 'nightlife'],
  'Kids & Family': ['family', 'kids'],
  'Comedy': ['comedy', 'entertainment'],
  'Food & Drink': ['food', 'drink'],
  'Art Exhibits & Events': ['art', 'culture'],
  'Lectures & Seminars': ['education', 'lectures'],
  'Theater & Dance': ['theater', 'performing-arts'],
  'Film': ['film', 'movies'],
  'Sports & Fitness': ['sports', 'fitness'],
  'Outdoors': ['outdoors', 'nature'],
};

// Vibe inference from categories
const inferVibe = (categories) => {
  let quietScore = 0.5; // default neutral
  let insideScore = 0.5;

  const cats = categories.map(c => c.toLowerCase());

  // Adjust quiet score
  if (cats.some(c => ['music', 'dancing', 'nightlife', 'sports'].includes(c))) {
    quietScore = 0.2; // loud/social
  } else if (cats.some(c => ['art', 'lectures', 'film', 'reading'].includes(c))) {
    quietScore = 0.7; // quiet
  }

  // Adjust inside/outside score
  if (cats.some(c => ['outdoors', 'nature', 'sports'].includes(c))) {
    insideScore = 0.2; // outside
  } else if (cats.some(c => ['theater', 'film', 'lectures'].includes(c))) {
    insideScore = 0.9; // inside
  }

  return { quiet: quietScore, inside: insideScore };
};

// Extract price info from string
const parsePrice = (priceStr) => {
  if (!priceStr) return { isFree: true, min: null, max: null, description: 'Free' };

  const lower = priceStr.toLowerCase();
  if (lower.includes('free')) {
    return { isFree: true, min: null, max: null, description: priceStr };
  }

  // Try to extract numbers
  const matches = priceStr.match(/\$?(\d+(?:\.\d{2})?)/g);
  if (matches) {
    const prices = matches.map(m => parseFloat(m.replace('$', '')));
    return {
      isFree: false,
      min: Math.min(...prices),
      max: Math.max(...prices),
      description: priceStr
    };
  }

  return { isFree: false, min: null, max: null, description: priceStr };
};

// Generate slug from title
const slugify = (text) => {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .trim();
};

async function scrapeIsthmus(maxPages = 5) {
  console.log('🚀 Starting Isthmus scraper...');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    const allEvents = [];
    let currentPage = 1;

    while (currentPage <= maxPages) {
      console.log(`📄 Scraping page ${currentPage}...`);

      const url = currentPage === 1
        ? 'https://isthmus.com/search/event/calendar-of-events'
        : `https://isthmus.com/search/event/calendar-of-events?page=${currentPage}`;

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Extract JSON-LD structured data
      const events = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        const eventData = [];

        scripts.forEach(script => {
          try {
            const data = JSON.parse(script.textContent);
            if (data['@type'] === 'Event' || (Array.isArray(data) && data[0]?.['@type'] === 'Event')) {
              const events = Array.isArray(data) ? data : [data];
              eventData.push(...events.filter(e => e['@type'] === 'Event'));
            }
          } catch (e) {
            // Skip invalid JSON
          }
        });

        return eventData;
      });

      // Also scrape visible event cards for additional data
      const cardEvents = await page.evaluate(() => {
        const cards = document.querySelectorAll('.event-card, .search-result');
        return Array.from(cards).map(card => {
          const titleEl = card.querySelector('h3, h2, .title');
          const timeEl = card.querySelector('.time, .date-time');
          const locationEl = card.querySelector('.location, .venue');
          const descEl = card.querySelector('.description, .summary');
          const linkEl = card.querySelector('a');
          const imageEl = card.querySelector('img');
          const categoriesEl = card.querySelectorAll('.category, .tag');

          return {
            title: titleEl?.textContent?.trim(),
            time: timeEl?.textContent?.trim(),
            location: locationEl?.textContent?.trim(),
            description: descEl?.textContent?.trim(),
            url: linkEl?.href,
            image: imageEl?.src,
            categories: Array.from(categoriesEl).map(c => c.textContent.trim())
          };
        }).filter(e => e.title);
      });

      console.log(`  Found ${events.length} JSON-LD events, ${cardEvents.length} card events`);

      // Merge structured data with scraped data
      const mergedEvents = events.map(jsonEvent => {
        // Try to find matching card event by title
        const cardMatch = cardEvents.find(ce =>
          ce.title && jsonEvent.name &&
          ce.title.toLowerCase().includes(jsonEvent.name.toLowerCase().substring(0, 20))
        );

        return {
          ...jsonEvent,
          scrapedData: cardMatch || {}
        };
      });

      allEvents.push(...mergedEvents);

      // Check if there's a next page
      const hasNext = await page.evaluate(() => {
        const nextBtn = document.querySelector('a[rel="next"], .next-page, .pagination__next');
        return nextBtn !== null;
      });

      if (!hasNext) {
        console.log('  No more pages found');
        break;
      }

      currentPage++;

      // Be polite - wait between requests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`✅ Scraped ${allEvents.length} total events from Isthmus`);
    return allEvents;

  } finally {
    await browser.close();
  }
}

async function saveToDatabase(events) {
  console.log('💾 Saving events to database...');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get Madison city_id
    const cityResult = await client.query(
      "SELECT id FROM cities WHERE slug = 'madison'"
    );
    const cityId = cityResult.rows[0].id;

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const event of events) {
      try {
        // Extract data from JSON-LD format
        const title = event.name || event.scrapedData?.title;
        const description = event.description || event.scrapedData?.description;
        const startTime = event.startDate;
        const endTime = event.endDate;

        if (!title || !startTime) {
          skipped++;
          continue;
        }

        // Location data
        const location = event.location || {};
        const venueName = location.name || event.scrapedData?.location;
        const venueAddress = location.address?.streetAddress ||
                             location.address ||
                             event.scrapedData?.location;

        // Geo coordinates
        const geo = location.geo || {};
        const lat = geo.latitude || null;
        const lng = geo.longitude || null;

        // Categories
        const categories = event.scrapedData?.categories || [];
        const mappedTags = categories.flatMap(cat => CATEGORY_MAPPING[cat] || [cat.toLowerCase()]);

        // Infer vibe from categories
        const vibe = inferVibe(mappedTags);

        // Price info
        const priceInfo = parsePrice(event.offers?.price || event.offers?.priceSpecification?.price);

        // Generate source ID and slug
        const sourceUrl = event.url || event.scrapedData?.url || '';
        const sourceId = event['@id'] || event.identifier || sourceUrl.split('/').pop() || `${slugify(title)}-${startTime}`;
        const slug = slugify(title);

        // Image
        const imageUrl = event.image?.url || event.image || event.scrapedData?.image;

        // Kid-friendly inference (basic heuristic)
        const kidFriendly = categories.some(c => c.toLowerCase().includes('kid') || c.toLowerCase().includes('family'));

        // Insert or update
        const result = await client.query(`
          INSERT INTO scraped_events_raw (source, source_id, raw_data)
          VALUES ($1, $2, $3)
          ON CONFLICT (source, source_id, scraped_at) DO NOTHING
          RETURNING id
        `, ['isthmus', sourceId, event]);

        if (result.rows.length > 0) {
          // Also insert into events table
          await client.query(`
            INSERT INTO events (
              city_id, title, slug, description,
              start_time, end_time,
              venue_name, venue_address, lat, lng,
              vibe_quiet, vibe_inside,
              categories, tags,
              kid_friendly,
              is_free, price_min, price_max, price_description,
              website, source_url, image_url,
              source, source_id, scraped_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
              $11, $12, $13, $14, $15, $16, $17, $18, $19,
              $20, $21, $22, $23, $24, NOW()
            )
            ON CONFLICT (source, source_id) DO UPDATE SET
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              start_time = EXCLUDED.start_time,
              end_time = EXCLUDED.end_time,
              venue_name = EXCLUDED.venue_name,
              updated_at = NOW()
          `, [
            cityId, title, slug, description,
            startTime, endTime,
            venueName, venueAddress, lat, lng,
            vibe.quiet, vibe.inside,
            categories, mappedTags,
            kidFriendly,
            priceInfo.isFree, priceInfo.min, priceInfo.max, priceInfo.description,
            event.url, sourceUrl, imageUrl,
            'isthmus', sourceId
          ]);

          inserted++;
        } else {
          updated++;
        }

      } catch (err) {
        console.error(`  ❌ Error processing event: ${event.name || 'unknown'}`, err.message);
        skipped++;
      }
    }

    await client.query('COMMIT');

    console.log(`✅ Database save complete:`);
    console.log(`   - Inserted: ${inserted}`);
    console.log(`   - Updated: ${updated}`);
    console.log(`   - Skipped: ${skipped}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database error:', err);
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    const events = await scrapeIsthmus(5);
    await saveToDatabase(events);
    console.log('🎉 Isthmus scraper completed successfully');
  } catch (err) {
    console.error('❌ Scraper failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { scrapeIsthmus, saveToDatabase };
