// next-task.js — /next-task skill: pulls priority task from task list each morning
const Database = require('better-sqlite3');
const path = require('path');

function setupNextTask(bot, chatId, callModel, SYSTEM) {
  const db = new Database(path.join(__dirname, 'ibis_memory.db'));

  // Create tasks table if not exists
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

  function getOpenTasks() {
    return db.prepare("SELECT * FROM tasks WHERE status='open' ORDER BY priority ASC, created_at ASC").all();
  }

  function addTask(title, priority, context, dueDate) {
    db.prepare('INSERT INTO tasks (title, priority, context, due_date) VALUES (?, ?, ?, ?)').run(title, priority || 3, context || '', dueDate || null);
  }

  function completeTask(id) {
    db.prepare("UPDATE tasks SET status='done', completed_at=strftime('%s','now') WHERE id=?").run(id);
  }

  bot.on('message', async (msg) => {
    if (msg.chat.id !== chatId) return;
    const text = (msg.text || '').trim();

    // /next-task — show top priority task
    if (text === '/next' || text === '/next-task') {
      const tasks = getOpenTasks();
      if (tasks.length === 0) {
        await bot.sendMessage(chatId, '✅ No open tasks. You\'re clear.');
        return;
      }
      const top = tasks[0];
      const priLabel = ['', '🔴 CRITICAL', '🟠 HIGH', '🟡 MEDIUM', '🔵 LOW', '⚪ SOMEDAY'][top.priority] || '🟡';
      const remaining = tasks.length - 1;
      let msg_text = `🎯 *Next Task*\n\n${priLabel}\n*${top.title}*`;
      if (top.context) msg_text += `\n${top.context}`;
      if (top.due_date) msg_text += `\n📅 Due: ${top.due_date}`;
      msg_text += `\n\n_${remaining} more tasks in queue_\nDone? Say \`done ${top.id}\``;
      await bot.sendMessage(chatId, msg_text, { parse_mode: 'Markdown' });
      return;
    }

    // /tasks — list all open tasks
    if (text === '/tasks') {
      const tasks = getOpenTasks();
      if (tasks.length === 0) { await bot.sendMessage(chatId, '✅ No open tasks.'); return; }
      const priEmoji = ['', '🔴', '🟠', '🟡', '🔵', '⚪'];
      const lines = tasks.map(t => `${priEmoji[t.priority] || '🟡'} \`${t.id}\` ${t.title}${t.due_date ? ' 📅' + t.due_date : ''}`);
      await bot.sendMessage(chatId, `📋 *Open Tasks (${tasks.length})*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
      return;
    }

    // task <priority> <title> — add task (priority 1-5, default 3)
    if (text.startsWith('task ')) {
      const rest = text.slice(5).trim();
      const priMatch = rest.match(/^(\d)\s+(.+)/);
      let priority = 3, title = rest;
      if (priMatch) { priority = parseInt(priMatch[1]); title = priMatch[2]; }
      addTask(title, priority);
      await bot.sendMessage(chatId, `✅ Task added: *${title}* (priority ${priority})`, { parse_mode: 'Markdown' });
      return;
    }

    // done <id> — complete a task
    if (text.startsWith('done ')) {
      const id = parseInt(text.slice(5).trim());
      if (id) {
        completeTask(id);
        await bot.sendMessage(chatId, `✅ Task #${id} completed.`);
      }
      return;
    }
  });

  // Morning task push at 9:05am (after briefing)
  setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 9 && now.getMinutes() === 5) {
      const tasks = getOpenTasks();
      if (tasks.length > 0) {
        const top3 = tasks.slice(0, 3);
        const priEmoji = ['', '🔴', '🟠', '🟡', '🔵', '⚪'];
        const lines = top3.map(t => `${priEmoji[t.priority] || '🟡'} ${t.title}`);
        await bot.sendMessage(chatId, `🎯 *Top Tasks for Today*\n\n${lines.join('\n')}\n\nSay /next for details.`, { parse_mode: 'Markdown' });
      }
    }
  }, 60 * 1000);

  console.log('✅ Next-task skill active — /next, /tasks, task <title>, done <id>');
}

module.exports = { setupNextTask };
