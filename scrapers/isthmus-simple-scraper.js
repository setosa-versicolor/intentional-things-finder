/**
 * Simplified Isthmus scraper using axios + cheerio (no Puppeteer)
 * More reliable on Windows
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const slugify = (text) => {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .trim();
};

async function scrapeIsthmusSimple() {
  console.log('🚀 Starting simple Isthmus scraper...');

  try {
    const url = 'https://isthmus.com/search/event/calendar-of-events';
    console.log(`📄 Fetching ${url}...`);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 30000,
    });

    const $ = cheerio.load(response.data);
    const events = [];

    // Look for event cards/items
    $('.search-result, .event-item, article').each((i, elem) => {
      const $elem = $(elem);

      const title = $elem.find('h2, h3, .title, .event-title').first().text().trim();
      const date = $elem.find('.date, .event-date, time').first().text().trim();
      const location = $elem.find('.location, .venue').first().text().trim();
      const description = $elem.find('.description, .summary, p').first().text().trim();
      const link = $elem.find('a').first().attr('href');
      const image = $elem.find('img').first().attr('src');

      if (title) {
        events.push({
          title,
          date,
          location,
          description,
          link: link ? (link.startsWith('http') ? link : `https://isthmus.com${link}`) : null,
          image: image ? (image.startsWith('http') ? image : `https://isthmus.com${image}`) : null,
        });
      }
    });

    console.log(`✅ Found ${events.length} events`);

    if (events.length === 0) {
      console.log('⚠️  No events found. The page structure might have changed.');
      console.log('    Saving page HTML to debug...');
      const fs = await import('fs');
      fs.default.writeFileSync('isthmus-page.html', response.data);
      console.log('    Saved to: isthmus-page.html');
    }

    return events;

  } catch (error) {
    console.error('❌ Scraper failed:', error.message);
    return [];
  }
}

async function saveToDatabase(events) {
  if (events.length === 0) {
    console.log('⚠️  No events to save');
    return;
  }

  console.log('💾 Saving events to database...');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const cityResult = await client.query("SELECT id FROM cities WHERE slug = 'madison'");
    const cityId = cityResult.rows[0].id;

    let inserted = 0;
    let skipped = 0;

    for (const event of events) {
      try {
        const slug = slugify(event.title);
        const sourceId = `${slug}-${Date.now()}`;

        // Insert into events table
        await client.query(`
          INSERT INTO events (
            city_id, title, slug, description,
            start_time, venue_name, source_url, image_url,
            source, source_id, scraped_at, is_active
          ) VALUES (
            $1, $2, $3, $4, NOW() + INTERVAL '1 day', $5, $6, $7, $8, $9, NOW(), TRUE
          )
          ON CONFLICT (source, source_id) DO NOTHING
        `, [
          cityId,
          event.title,
          slug,
          event.description,
          event.location,
          event.link,
          event.image,
          'isthmus-simple',
          sourceId,
        ]);

        inserted++;
      } catch (err) {
        console.error(`  Error with event "${event.title}":`, err.message);
        skipped++;
      }
    }

    await client.query('COMMIT');

    console.log(`✅ Database save complete:`);
    console.log(`   - Inserted: ${inserted}`);
    console.log(`   - Skipped: ${skipped}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database error:', err);
  } finally {
    client.release();
  }
}

async function main() {
  try {
    const events = await scrapeIsthmusSimple();
    await saveToDatabase(events);
    console.log('🎉 Scraper completed');
  } catch (err) {
    console.error('❌ Failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
