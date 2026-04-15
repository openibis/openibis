const { execSync } = require('child_process');

async function webSweep(query, callModel) {
  try {
    const axios = require('axios');
    const cheerio = require('cheerio');
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    const r = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
    const $ = cheerio.load(r.data);
    const results = [];
    $('.result__snippet').each((i, el) => { if (i < 4) results.push($(el).text().trim()); });
    return results.join('\n') || 'No results';
  } catch(e) { return 'Search error: ' + e.message; }
}

async function runDailySweep(bot, chatId, callModel, SYSTEM) {
  await bot.sendMessage(chatId, '🔍 *IBIS Daily Intelligence Sweep starting...*', { parse_mode: 'Markdown' });

  const topics = [
    'AI agents news today',
    'home care industry NJ news',
    'GitHub trending AI projects today',
    'ExNTER philosophy content ideas',
    'TikTok trending topics today'
  ];

  const results = [];
  for (const topic of topics) {
    const data = await webSweep(topic, callModel);
    results.push(`TOPIC: ${topic}\n${data}`);
  }

  const sweepText = results.join('\n\n');

  // Generate briefing
  const briefing = await callModel('long', [{
    role: 'user',
    content: `You are IBIS, Soul's governing AI. Based on this web intelligence gathered today, generate:
1. TOP 3 things Soul needs to know right now
2. TOP 3 content ideas for TikTok/X based on trends
3. ONE proactive suggestion for her businesses

Be sharp, direct, no fluff. Soul is building: 24 Hour Home Care NJ, ExNTER.com, OpenClaw AI.

INTELLIGENCE:\n${sweepText.slice(0, 3000)}`
  }], SYSTEM);

  await bot.sendMessage(chatId, '🧠 IBIS Intelligence Briefing\n\n' + briefing);

  // Store in memory
  execSync(`python3 ${__dirname}/memory_palace.py store "sweep_${Date.now()}" ${JSON.stringify(briefing.slice(0,500))} "sweep,intelligence,daily"`);
}

function setupSweep(bot, chatId, callModel, SYSTEM) {
  // Run at 8am daily
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 8 && now.getMinutes() === 0) {
      runDailySweep(bot, chatId, callModel, SYSTEM);
    }
  }, 60 * 1000);

  console.log('✅ Daily sweep scheduled — runs at 8am');
}

module.exports = { setupSweep, runDailySweep };
