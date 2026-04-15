const fs = require('fs');
const { execSync } = require('child_process');
const axios = require('axios');
const cheerio = require('cheerio');

async function webSearch(query) {
  try {
    const r = await axios.get('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
      headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000
    });
    const $ = cheerio.load(r.data);
    const results = [];
    $('.result__snippet').each((i, el) => { if (i < 5) results.push($(el).text().trim()); });
    return results.join('\n');
  } catch(e) { return ''; }
}

async function runEvolution(bot, chatId, callModel, SYSTEM) {
  await bot.sendMessage(chatId, '🧬 IBIS Evolution cycle starting...');

  // Step 1 — research what IBIS can learn
  const researchTopics = [
    'new Node.js AI agent capabilities 2026',
    'Telegram bot new features API 2026',
    'best npm packages for AI automation 2026',
    'how to make AI agents self-improving',
  ];

  let gathered = '';
  for (const topic of researchTopics) {
    const result = await webSearch(topic);
    gathered += `\nTOPIC: ${topic}\n${result}\n`;
  }

  // Step 2 — ask IBIS to reason about what to build
  const plan = await callModel('reasoning', [{
    role: 'user',
    content: `You are IBIS, a self-evolving AI agent running on Node.js on a Mac. 
You have these current capabilities: Telegram messaging, web search, SQLite memory, ChromaDB semantic memory, OpenRouter AI routing, proactive scheduling, inbox filing, offline queue.

Based on this research, propose ONE new concrete skill you can add to yourself tonight. It must be:
- Buildable in Node.js or Python
- Under 50 lines of code
- Genuinely useful to Soul (YOUR_NAME) who runs 24 Hour Home Care NJ, ExNTER.com, OpenClaw AI
- Something you don't already have

Research:\n${gathered.slice(0, 3000)}

Reply in this exact format:
SKILL_NAME: name_of_skill
DESCRIPTION: what it does in one sentence
WHY: why Soul needs this
CODE_HINT: brief description of how to implement it`
  }], SYSTEM);

  // Step 3 — parse the plan
  const nameMatch = plan.match(/SKILL_NAME:\s*(.+)/);
  const descMatch = plan.match(/DESCRIPTION:\s*(.+)/);
  const whyMatch = plan.match(/WHY:\s*(.+)/);
  
  const skillName = nameMatch ? nameMatch[1].trim() : 'new_skill';
  const skillDesc = descMatch ? descMatch[1].trim() : '';
  const skillWhy = whyMatch ? whyMatch[1].trim() : '';

  // Step 4 — ask IBIS to write the actual code
  const code = await callModel('reasoning', [{
    role: 'user',
    content: `Write a complete Node.js module for this skill:
Name: ${skillName}
Description: ${skillDesc}

Requirements:
- Export a setup function: module.exports = { setup${skillName.replace(/_/g,'')} }
- The setup function receives (bot, chatId, callModel, SYSTEM)
- Must be self-contained, under 60 lines
- Log a green checkmark when active
- Must actually work

Write ONLY the code, no explanation, no markdown backticks.`
  }], SYSTEM);

  // Step 5 — save the new skill file
  const skillPath = __dirname + `/skill_${skillName}.js`;
  const cleanCode = code.replace(/```javascript|```js|```/g, '').trim();
  fs.writeFileSync(skillPath, cleanCode);

  // Step 6 — store evolution log in memory
  const logEntry = `IBIS evolved: added ${skillName} — ${skillDesc}. Reason: ${skillWhy}. Date: ${new Date().toISOString()}`;
  execSync(`python3 ${__dirname}/memory_palace.py store "evolution_${Date.now()}" ${JSON.stringify(logEntry)} "evolution,self-improvement"`);

  // Step 7 — report to Soul
  const report = `🧬 IBIS Evolution Complete

New skill acquired: ${skillName}
What it does: ${skillDesc}
Why you need it: ${skillWhy}

Skill file saved: skill_${skillName}.js
Logged to memory palace.

Say "load skill ${skillName}" to activate it, or I will load it next restart.`;

  await bot.sendMessage(chatId, report);
}

function setupEvolution(bot, chatId, callModel, SYSTEM) {
  // Run evolution at 3am nightly
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 3 && now.getMinutes() === 0) {
      runEvolution(bot, chatId, callModel, SYSTEM);
    }
  }, 60 * 1000);

  console.log('✅ Self-evolution engine running — evolves at 3am nightly');
}

module.exports = { setupEvolution, runEvolution };
