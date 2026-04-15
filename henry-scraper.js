// henry-scraper.js — Henry Ivis daily web scraper using FireCrawl
const FirecrawlApp = require('@mendable/firecrawl-js').default;

const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY || '';

const DAILY_TARGETS = [
  { name: 'NJ Home Care News', url: 'https://www.njhomecareassociation.com', query: 'home care news NJ' },
  { name: 'CMS Updates', url: 'https://www.cms.gov/newsroom', query: 'medicare medicaid home health' },
  { name: 'AI Agent News', url: 'https://news.ycombinator.com', query: 'AI agents' },
];

async function scrapeDaily(callModel, SYSTEM) {
  if (!FIRECRAWL_KEY) return 'FireCrawl API key not set. Set FIRECRAWL_API_KEY env var.';
  const firecrawl = new FirecrawlApp({ apiKey: FIRECRAWL_KEY });
  const results = [];

  for (const target of DAILY_TARGETS) {
    try {
      const response = await firecrawl.scrapeUrl(target.url, { formats: ['markdown'] });
      if (response.success) {
        const content = (response.markdown || '').slice(0, 2000);
        results.push(`[${target.name}]\n${content}`);
      }
    } catch(e) {
      results.push(`[${target.name}] Scrape failed: ${e.message}`);
    }
  }

  const raw = results.join('\n\n---\n\n');
  const summary = await callModel('long', [{
    role: 'user',
    content: `You are Henry Ivis, IBIS Operations agent. Summarize this daily web scrape into an operations intelligence brief for Soul.
Focus on: regulatory changes, competitor moves, industry trends, tech opportunities.
Be direct, bullet points, max 15 lines.\n\nRAW DATA:\n${raw.slice(0, 4000)}`
  }], SYSTEM);

  return summary;
}

function setupHenryScraper(bot, chatId, callModel, SYSTEM) {
  // Run at 7am daily
  setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 7 && now.getMinutes() === 0) {
      try {
        const brief = await scrapeDaily(callModel, SYSTEM);
        await bot.sendMessage(chatId, `📋 *Henry Ivis — Daily Scrape*\n\n${brief}`, { parse_mode: 'Markdown' });
      } catch(e) {
        console.error('[henry-scraper]', e.message);
      }
    }
  }, 60 * 1000);

  console.log('✅ Henry scraper active — daily web scrape at 7am');
}

module.exports = { setupHenryScraper, scrapeDaily };
