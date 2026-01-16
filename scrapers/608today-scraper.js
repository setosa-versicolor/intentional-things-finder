/**
 * 608today Event Scraper
 *
 * Scrapes events from https://608today.6amcity.com/events
 * Note: This site appears to be article-based rather than structured events
 * We'll parse event details from article content
 */

import puppeteer from 'puppeteer';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Category mapping
const CATEGORY_MAPPING = {
  'Events': ['events'],
  'Play': ['entertainment', 'recreation'],
  'Food': ['food', 'dining'],
  'Culture': ['culture', 'arts'],
  'Sports': ['sports'],
  'Music': ['music', 'live-music'],
  'Arts': ['arts', 'culture'],
};

const slugify = (text) => {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .trim();
};

// Parse date from various formats
const parseEventDate = (dateStr, articleDate) => {
  if (!dateStr) return null;

  // Try common date patterns
  const patterns = [
    /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i,  // "January 15, 2026"
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/,    // "1/15/2026"
    /(\w+)\s+(\d{1,2})/i,               // "January 15" (use article year)
  ];

  for (const pattern of patterns) {
    const match = dateStr.match(pattern);
    if (match) {
      try {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      } catch (e) {
        continue;
      }
    }
  }

  // Fallback: use article publication date if available
  return articleDate || null;
};

// Extract event info from article text
const extractEventDetails = (article) => {
  const text = article.content || article.excerpt || '';

  // Look for time patterns in text
  const timePatterns = [
    /(\d{1,2}):(\d{2})\s*(am|pm)/gi,
    /(\d{1,2})\s*(am|pm)/gi,
  ];

  let timeMatch = null;
  for (const pattern of timePatterns) {
    timeMatch = text.match(pattern);
    if (timeMatch) break;
  }

  // Look for location/venue patterns
  const locationPatterns = [
    /at\s+([A-Z][A-Za-z\s&]+?)(?:\s+on|\s+from|\.|,)/,
    /location:\s*([^.\n]+)/i,
    /venue:\s*([^.\n]+)/i,
  ];

  let locationMatch = null;
  for (const pattern of locationPatterns) {
    locationMatch = text.match(pattern);
    if (locationMatch) break;
  }

  return {
    time: timeMatch?.[0] || null,
    location: locationMatch?.[1]?.trim() || null,
  };
};

async function scrape608Today(maxEvents = 50) {
  console.log('🚀 Starting 608today scraper...');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    await page.goto('https://608today.6amcity.com/events', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.log('📄 Scraping events...');

    const allArticles = [];
    let loadMoreAttempts = 0;
    const maxLoadMore = 5;

    // Initial articles
    let articles = await page.evaluate(() => {
      const items = document.querySelectorAll('article, .event-card, .post-item');
      return Array.from(items).map(item => {
        const titleEl = item.querySelector('h1, h2, h3, .title, .headline');
        const dateEl = item.querySelector('.date, .publication-date, time');
        const authorEl = item.querySelector('.author, .contributor');
        const categoryEl = item.querySelector('.category, .tag');
        const excerptEl = item.querySelector('.excerpt, .description, p');
        const linkEl = item.querySelector('a');
        const imageEl = item.querySelector('img');

        return {
          title: titleEl?.textContent?.trim(),
          publicationDate: dateEl?.getAttribute('datetime') || dateEl?.textContent?.trim(),
          author: authorEl?.textContent?.trim(),
          category: categoryEl?.textContent?.trim(),
          excerpt: excerptEl?.textContent?.trim(),
          url: linkEl?.href,
          image: imageEl?.src,
        };
      }).filter(a => a.title && a.url);
    });

    allArticles.push(...articles);
    console.log(`  Found ${articles.length} initial articles`);

    // Try to load more
    while (loadMoreAttempts < maxLoadMore && allArticles.length < maxEvents) {
      const loadMoreBtn = await page.$('button.load-more, .load-more, [data-load-more]');

      if (!loadMoreBtn) {
        console.log('  No "Load More" button found');
        break;
      }

      console.log(`  Clicking "Load More" (attempt ${loadMoreAttempts + 1})...`);

      await loadMoreBtn.click();
      await page.waitForTimeout(2000);

      // Get new articles
      const newArticles = await page.evaluate((existingCount) => {
        const items = document.querySelectorAll('article, .event-card, .post-item');
        return Array.from(items).slice(existingCount).map(item => {
          const titleEl = item.querySelector('h1, h2, h3, .title, .headline');
          const dateEl = item.querySelector('.date, .publication-date, time');
          const authorEl = item.querySelector('.author, .contributor');
          const categoryEl = item.querySelector('.category, .tag');
          const excerptEl = item.querySelector('.excerpt, .description, p');
          const linkEl = item.querySelector('a');
          const imageEl = item.querySelector('img');

          return {
            title: titleEl?.textContent?.trim(),
            publicationDate: dateEl?.getAttribute('datetime') || dateEl?.textContent?.trim(),
            author: authorEl?.textContent?.trim(),
            category: categoryEl?.textContent?.trim(),
            excerpt: excerptEl?.textContent?.trim(),
            url: linkEl?.href,
            image: imageEl?.src,
          };
        }).filter(a => a.title && a.url);
      }, allArticles.length);

      if (newArticles.length === 0) {
        console.log('  No new articles loaded');
        break;
      }

      allArticles.push(...newArticles);
      console.log(`  Loaded ${newArticles.length} more articles (total: ${allArticles.length})`);
      loadMoreAttempts++;
    }

    // Filter for event-related articles
    const eventArticles = allArticles.filter(article => {
      const title = article.title.toLowerCase();
      const category = (article.category || '').toLowerCase();

      return (
        category.includes('event') ||
        title.includes('event') ||
        title.includes('happening') ||
        title.includes('festival') ||
        title.includes('concert') ||
        title.includes('show') ||
        title.includes('market')
      );
    });

    console.log(`✅ Scraped ${eventArticles.length} event articles from 608today`);
    return eventArticles;

  } finally {
    await browser.close();
  }
}

async function saveToDatabase(articles) {
  console.log('💾 Saving articles to database...');

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

    for (const article of articles) {
      try {
        const title = article.title;
        const description = article.excerpt;

        if (!title) {
          skipped++;
          continue;
        }

        // Extract event details from article text
        const details = extractEventDetails(article);

        // Parse date
        const startTime = parseEventDate(details.time, article.publicationDate);

        // Category mapping
        const category = article.category || 'Events';
        const mappedTags = CATEGORY_MAPPING[category] || [category.toLowerCase()];

        // Generate source ID
        const sourceId = article.url.split('/').filter(Boolean).pop() || slugify(title);
        const slug = slugify(title);

        // Default vibe for 608today articles (tend to be more curated/editorial)
        const vibeQuiet = 0.5;
        const vibeInside = 0.5;

        // Insert into raw table
        const result = await client.query(`
          INSERT INTO scraped_events_raw (source, source_id, raw_data)
          VALUES ($1, $2, $3)
          ON CONFLICT (source, source_id, scraped_at) DO NOTHING
          RETURNING id
        `, ['608today', sourceId, article]);

        if (result.rows.length > 0 && startTime) {
          // Insert into events table
          await client.query(`
            INSERT INTO events (
              city_id, title, slug, description,
              start_time,
              venue_name,
              vibe_quiet, vibe_inside,
              categories, tags,
              website, source_url, image_url,
              source, source_id, scraped_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()
            )
            ON CONFLICT (source, source_id) DO UPDATE SET
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              updated_at = NOW()
          `, [
            cityId, title, slug, description,
            startTime,
            details.location,
            vibeQuiet, vibeInside,
            [category], mappedTags,
            article.url, article.url, article.image,
            '608today', sourceId
          ]);

          inserted++;
        } else {
          skipped++;
        }

      } catch (err) {
        console.error(`  ❌ Error processing article: ${article.title}`, err.message);
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
    const articles = await scrape608Today(50);
    await saveToDatabase(articles);
    console.log('🎉 608today scraper completed successfully');
  } catch (err) {
    console.error('❌ Scraper failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
// Convert argv[1] to file URL with forward slashes for cross-platform compatibility
if (import.meta.url === new URL(process.argv[1], 'file:').href ||
    import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  main();
}

export { scrape608Today, saveToDatabase };
