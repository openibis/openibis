// proactive.js — IBIS unprompted Telegram messages
const Database = require('better-sqlite3');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { runReleaseMonitor } = require('./skills/release-monitor.js');

const NEWSAPI_KEY = process.env.NEWSAPI_KEY || '';

async function fetchNewsDigest() {
  const topics = ['home care industry', 'healthcare staffing', 'AI business automation'];
  const headlines = [];
  for (const q of topics) {
    try {
      const res = await axios.get('https://newsapi.org/v2/everything', {
        params: { q, sortBy: 'publishedAt', pageSize: 3, apiKey: NEWSAPI_KEY, language: 'en' },
        timeout: 8000
      });
      for (const a of (res.data.articles || [])) {
        headlines.push(`[${q}] ${a.title}`);
      }
    } catch(e) { /* skip failed topic */ }
  }
  return headlines.length ? headlines.join('\n') : '';
}

async function fetchEmpireUpdate(db, callModel, SYSTEM) {
  // Gather signals from memory, tasks, and SMS for each business
  const businesses = [
    { name: '24 Hour Home Care NJ', keys: ['24hour', 'homecare', 'hcnj', 'caregiver', 'aide', 'patient'] },
    { name: 'Bonjour Home Care Group', keys: ['bonjour', 'bhcg', 'home care group'] },
    { name: 'ExNTER.com', keys: ['exnter', 'content', 'tiktok', 'philosophy'] },
  ];

  const signals = [];
  for (const biz of businesses) {
    const pattern = biz.keys.map(k => `key LIKE '%${k}%' OR value LIKE '%${k}%'`).join(' OR ');
    const mentions = db.prepare(`SELECT key, value FROM knowledge WHERE ${pattern} ORDER BY ts DESC LIMIT 3`).all();
    const recentMsgs = db.prepare(
      `SELECT content FROM messages WHERE role='user' AND (${biz.keys.map(k => `content LIKE '%${k}%'`).join(' OR ')}) ORDER BY ts DESC LIMIT 3`
    ).all();

    let signal = `${biz.name}: `;
    if (mentions.length > 0 || recentMsgs.length > 0) {
      const items = [
        ...mentions.map(m => m.value.slice(0, 80)),
        ...recentMsgs.map(m => m.content.slice(0, 80)),
      ];
      signal += items.slice(0, 2).join('; ');
    } else {
      signal += 'No recent activity';
    }
    signals.push(signal);
  }

  // Check tasks
  let taskSummary = '';
  try {
    const openTasks = db.prepare("SELECT title, priority FROM tasks WHERE status='open' ORDER BY priority ASC LIMIT 5").all();
    if (openTasks.length > 0) {
      const priEmoji = ['', '🔴', '🟠', '🟡', '🔵', '⚪'];
      taskSummary = openTasks.map(t => `${priEmoji[t.priority] || '🟡'} ${t.title}`).join('\n');
    }
  } catch(e) { /* tasks table may not exist yet */ }

  return { signals, taskSummary };
}

function setupProactive(bot, chatId, callModel, SYSTEM, anthropicKey) {
  const db = new Database(path.join(__dirname, 'ibis_memory.db'));

  // Track last fire times to prevent duplicate sends within the same minute
  const lastFired = {};
  function shouldFire(key, h, m) {
    const tag = `${key}_${h}_${m}`;
    const now = Date.now();
    if (lastFired[tag] && now - lastFired[tag] < 90000) return false;
    lastFired[tag] = now;
    return true;
  }

  // Check every minute
  setInterval(async () => {
    const d = new Date();
    const h = d.getHours();
    const m = d.getMinutes();
    const day = d.getDay(); // 0=Sun

    // 7:30am daily — release monitor
    if (h === 7 && m === 30 && shouldFire('release', h, m)) {
      runReleaseMonitor({ bot, chatId, anthropicKey }).catch(e => console.error('[proactive] release-monitor error:', e.message));
    }

    // 9:00am daily — morning briefing with news + empire update + backup status
    if (h === 9 && m === 0 && shouldFire('briefing', h, m)) {
      try {
        const memories = db.prepare('SELECT key, value FROM knowledge ORDER BY ts DESC LIMIT 10').all();
        const memText = memories.map(r => `• ${r.key}: ${r.value}`).join('\n') || 'No memories yet.';
        const newsDigest = await fetchNewsDigest();
        const newsSection = newsDigest ? `\nRelevant news headlines:\n${newsDigest}` : '';

        // Empire update
        const empire = await fetchEmpireUpdate(db, callModel, SYSTEM);
        const empireSection = `\n\nEmpire status:\n${empire.signals.join('\n')}`;
        const taskSection = empire.taskSummary ? `\n\nOpen tasks:\n${empire.taskSummary}` : '';

        // Backup status
        let backupLine = '';
        try {
          const statusPath = path.join(__dirname, 'backup-status.json');
          if (fs.existsSync(statusPath)) {
            const bs = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
            const icon = bs.status === 'ok' ? '✅' : '❌';
            backupLine = `\n💾 Last backup: ${bs.lastBackup || 'never'} — Status: ${icon}`;
          }
        } catch(e) {}

        const prompt = `Generate a sharp morning briefing for Soul (YOUR_NAME). Today is ${d.toDateString()}.
Be direct, no fluff. Structure it as:

1. TOP 3 PRIORITIES for today
2. EMPIRE UPDATE — one line per business based on the signals below. If no activity, suggest one action.
   - 24 Hour Home Care NJ
   - Bonjour Home Care Group
   - ExNTER.com
3. NEWS RADAR — if headlines provided, pick 2-3 most relevant to Soul's businesses
4. One PROACTIVE SUGGESTION

Current memory:\n${memText}${newsSection}${empireSection}${taskSection}`;

        const reply = await callModel('fast', [{role:'user',content:prompt}], SYSTEM);
        await bot.sendMessage(chatId, `🌅 *IBIS Morning Briefing*\n\n${reply}${backupLine}`, {parse_mode:'Markdown'});
      } catch(e) {
        console.error('[proactive] briefing error:', e.message);
      }
    }

    // Sunday 9am — weekly release digest
    if (day === 0 && h === 9 && m === 1 && shouldFire('weekly_release', h, m)) {
      runReleaseMonitor({ bot, chatId, anthropicKey }).catch(e => console.error('[proactive] weekly release-monitor error:', e.message));
    }

    // Sunday 6pm — weekly summary
    if (day === 0 && h === 18 && m === 0 && shouldFire('weekly_summary', h, m)) {
      try {
        const msgs = db.prepare(`SELECT content FROM messages WHERE role='user' ORDER BY ts DESC LIMIT 50`).all();
        const msgText = msgs.map(r => r.content).join('\n') || 'No activity logged.';
        const prompt = `Generate a weekly summary for Soul based on this week's activity. Be concise and strategic.\nActivity:\n${msgText}`;
        const reply = await callModel('long', [{role:'user',content:prompt}], SYSTEM);
        await bot.sendMessage(chatId, `📊 *IBIS Weekly Summary*\n\n${reply}`, {parse_mode:'Markdown'});
      } catch(e) {
        console.error('[proactive] weekly summary error:', e.message);
      }
    }

    // 2pm daily — check for anything flagged in memory needing attention
    if (h === 14 && m === 0 && shouldFire('flags', h, m)) {
      try {
        const flags = db.prepare("SELECT key, value FROM knowledge WHERE key LIKE '%urgent%' OR key LIKE '%flag%' OR key LIKE '%follow%' ORDER BY ts DESC LIMIT 5").all();
        if (flags.length > 0) {
          const flagText = flags.map(r => `• ${r.key}: ${r.value}`).join('\n');
          await bot.sendMessage(chatId, `🚨 *IBIS Attention Required*\n\n${flagText}`, {parse_mode:'Markdown'});
        }
      } catch(e) {
        console.error('[proactive] flags error:', e.message);
      }
    }

  }, 60 * 1000); // every 60 seconds

  console.log('Proactive scheduler running -- releases 7:30am, briefings 9am, alerts 2pm, weekly Sunday 6pm + 9am releases');
}

module.exports = { setupProactive };
