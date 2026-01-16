/**
 * Debug script to see what Puppeteer actually finds on the page
 */

import puppeteer from 'puppeteer';

async function debug() {
  console.log('🔍 Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    console.log('📄 Loading page...');
    await page.goto('https://isthmus.com/search/event/calendar-of-events', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.log('✅ Page loaded');

    // Check for JSON-LD
    const jsonLdCount = await page.evaluate(() => {
      return document.querySelectorAll('script[type="application/ld+json"]').length;
    });
    console.log(`Found ${jsonLdCount} JSON-LD script tags`);

    // Check for event cards with various selectors
    const selectors = [
      '.event-card',
      '.search-result',
      '[class*="event"]',
      '[class*="card"]',
      'article',
      '[data-event]',
      '.item'
    ];

    for (const selector of selectors) {
      const count = await page.evaluate((sel) => {
        return document.querySelectorAll(sel).length;
      }, selector);
      if (count > 0) {
        console.log(`Found ${count} elements matching: ${selector}`);
      }
    }

    // Get a sample of the HTML structure
    const sample = await page.evaluate(() => {
      const body = document.body.innerHTML;
      return body.substring(0, 5000); // First 5000 chars
    });

    console.log('\n📋 Sample HTML:');
    console.log(sample);

  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await browser.close();
  }
}

debug();
