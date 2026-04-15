// kairos.js — KAIROS pattern: always-on background loop that watches for tasks without being asked
// Named after the Greek god of the opportune moment
const Database = require('better-sqlite3');
const path = require('path');

function setupKairos(bot, chatId, callModel, SYSTEM) {
  const db = new Database(path.join(__dirname, 'ibis_memory.db'));

  // Ensure tasks table exists
  db.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    priority INTEGER DEFAULT 3,
    status TEXT DEFAULT 'open',
    context TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    due_date TEXT,
    completed_at INTEGER
  )`);

  // Ensure kairos_log table for tracking what KAIROS has surfaced
  db.exec(`CREATE TABLE IF NOT EXISTS kairos_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT,
    detail TEXT,
    ts INTEGER DEFAULT (strftime('%s','now'))
  )`);

  function logAction(action, detail) {
    db.prepare('INSERT INTO kairos_log (action, detail) VALUES (?, ?)').run(action, detail);
  }

  function recentlySurfaced(key) {
    const r = db.prepare("SELECT id FROM kairos_log WHERE detail LIKE ? AND ts > strftime('%s','now') - 86400").get('%' + key + '%');
    return !!r;
  }

  // KAIROS main loop — runs every 15 minutes
  const INTERVAL = 15 * 60 * 1000;

  async function kairosLoop() {
    try {
      const now = new Date();
      const h = now.getHours();

      // Only active during waking hours (7am - 11pm)
      if (h < 7 || h > 23) return;

      // 1. Check for overdue tasks
      const today = now.toISOString().split('T')[0];
      const overdue = db.prepare("SELECT * FROM tasks WHERE status='open' AND due_date IS NOT NULL AND due_date < ? ORDER BY priority ASC").all(today);
      for (const task of overdue) {
        if (!recentlySurfaced('overdue_' + task.id)) {
          await bot.sendMessage(chatId, `⏰ *Overdue Task*\n\n🔴 *${task.title}*\nWas due: ${task.due_date}\n\nReschedule or complete? Say \`done ${task.id}\``, { parse_mode: 'Markdown' });
          logAction('overdue_alert', 'overdue_' + task.id);
        }
      }

      // 2. Scan recent messages for implicit tasks
      const recentMsgs = db.prepare("SELECT content FROM messages WHERE role='user' ORDER BY ts DESC LIMIT 10").all();
      const msgText = recentMsgs.map(r => r.content).join('\n');

      if (msgText.length > 50) {
        const openTasks = db.prepare("SELECT title FROM tasks WHERE status='open'").all().map(t => t.title).join(', ');
        const response = await callModel('fast', [{
          role: 'user',
          content: `You are KAIROS, a background task detection system. Scan these recent messages for implicit tasks, commitments, or follow-ups that Soul may have mentioned but not formally tracked.

Current open tasks: ${openTasks || 'none'}

Recent messages:
${msgText.slice(0, 1500)}

If you find untracked commitments or tasks, list them in this format (one per line):
TASK: <title> | PRIORITY: <1-5> | REASON: <why>

If nothing new found, reply: NOTHING_NEW`
        }], SYSTEM);

        if (!response.includes('NOTHING_NEW') && response.includes('TASK:')) {
          const tasks = response.split('\n').filter(l => l.includes('TASK:'));
          const newTasks = [];
          for (const line of tasks.slice(0, 3)) {
            const titleMatch = line.match(/TASK:\s*(.+?)(?:\s*\||\s*$)/);
            const priMatch = line.match(/PRIORITY:\s*(\d)/);
            if (titleMatch) {
              const title = titleMatch[1].trim();
              const priority = priMatch ? parseInt(priMatch[1]) : 3;
              // Check if similar task exists
              const exists = db.prepare("SELECT id FROM tasks WHERE status='open' AND title LIKE ?").get('%' + title.slice(0, 20) + '%');
              if (!exists && !recentlySurfaced('suggest_' + title.slice(0, 30))) {
                newTasks.push({ title, priority });
              }
            }
          }

          if (newTasks.length > 0) {
            const lines = newTasks.map(t => `• ${t.title} (priority ${t.priority})`);
            await bot.sendMessage(chatId, `👁 *KAIROS detected untracked tasks*\n\n${lines.join('\n')}\n\nAdd them? Say \`task <priority> <title>\``, { parse_mode: 'Markdown' });
            logAction('task_suggestion', 'suggest_' + newTasks.map(t => t.title).join(',').slice(0, 100));
          }
        }
      }

      // 3. High-priority task nudge (every 2 hours for P1 tasks)
      if (h % 2 === 0 && now.getMinutes() < 15) {
        const critical = db.prepare("SELECT * FROM tasks WHERE status='open' AND priority=1 LIMIT 1").get();
        if (critical && !recentlySurfaced('nudge_' + critical.id + '_' + h)) {
          await bot.sendMessage(chatId, `🔴 *Reminder: Critical task open*\n${critical.title}\n\nDone? Say \`done ${critical.id}\``, { parse_mode: 'Markdown' });
          logAction('nudge', 'nudge_' + critical.id + '_' + h);
        }
      }

    } catch(e) {
      console.error('[kairos]', e.message);
    }
  }

  setInterval(kairosLoop, INTERVAL);
  // First run after 2 minutes
  setTimeout(kairosLoop, 2 * 60 * 1000);

  console.log('✅ KAIROS active — background task detection every 15min (7am-11pm)');
}

module.exports = { setupKairos };
