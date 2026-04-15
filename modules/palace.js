// modules/palace.js — MemPalace browser for Telegram
// /palace — list all rooms
// /palace <room> — show all entries in a room
// /palace <room>::<key> — show specific entry
// palace store <room>::<key> <value> — store new entry
const Database = require('better-sqlite3');
const path = require('path');

function setupPalace(bot, chatId) {
  const db = new Database(path.join(__dirname, '..', 'ibis_memory.db'));

  const ROOM_ICONS = {
    architect: '🏛',
    hfc: '🏥',
    ibisus: '🦅',
    pixel: '🖥',
    golden: '⚜️',
    vault: '🔐',
  };

  bot.on('message', async (msg) => {
    if (msg.chat.id !== chatId) return;
    const text = (msg.text || '').trim();

    // /palace — list all rooms with entry counts
    if (text === '/palace' || text === '/mempalace') {
      const rows = db.prepare("SELECT key FROM knowledge WHERE key LIKE '%::%' ORDER BY key").all();
      const roomCounts = {};
      for (const r of rows) {
        const room = r.key.split('::')[0];
        roomCounts[room] = (roomCounts[room] || 0) + 1;
      }

      const rooms = Object.entries(roomCounts).sort((a, b) => a[0].localeCompare(b[0]));
      const lines = rooms.map(([room, count]) => {
        const icon = ROOM_ICONS[room] || '📂';
        return `${icon} *${room}* — ${count} entries`;
      });

      const total = rows.length;
      await bot.sendMessage(chatId,
        `🏛 *IBIS Memory Palace*\n\n${lines.join('\n')}\n\n_${total} total entries_\n\nBrowse: \`/palace <room>\`\nRead: \`/palace room::key\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // /palace <room>::<key> — show specific entry
    if (text.startsWith('/palace ') && text.includes('::')) {
      const key = text.slice(8).trim();
      const row = db.prepare('SELECT key, value FROM knowledge WHERE key = ?').get(key);
      if (!row) {
        // Try partial match
        const partial = db.prepare('SELECT key, value FROM knowledge WHERE key LIKE ? LIMIT 1').get('%' + key + '%');
        if (partial) {
          await bot.sendMessage(chatId, `🏛 *${partial.key}*\n\n${partial.value}`, { parse_mode: 'Markdown' });
        } else {
          await bot.sendMessage(chatId, `Entry "${key}" not found.`);
        }
        return;
      }
      await bot.sendMessage(chatId, `🏛 *${row.key}*\n\n${row.value}`, { parse_mode: 'Markdown' });
      return;
    }

    // /palace <room> — list all entries in a room
    if (text.startsWith('/palace ')) {
      const room = text.slice(8).trim().toLowerCase();
      const rows = db.prepare("SELECT key, length(value) as len FROM knowledge WHERE key LIKE ? ORDER BY key").all(room + '::%');

      if (rows.length === 0) {
        await bot.sendMessage(chatId, `Room "${room}" not found or empty. Try /palace to see all rooms.`);
        return;
      }

      const icon = ROOM_ICONS[room] || '📂';
      const lines = rows.map(r => {
        const subkey = r.key.split('::')[1];
        return `• \`${r.key}\` (${r.len} chars)`;
      });

      await bot.sendMessage(chatId,
        `${icon} *${room.toUpperCase()} Room*\n\n${lines.join('\n')}\n\n_Read: \`/palace ${room}::entryname\`_`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // palace store <room>::<key> <value> — store new entry
    if (text.startsWith('palace store ')) {
      const rest = text.slice(13).trim();
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx < 0 || !rest.includes('::')) {
        await bot.sendMessage(chatId, 'Usage: `palace store room::key Your value here`', { parse_mode: 'Markdown' });
        return;
      }
      const key = rest.slice(0, spaceIdx).trim();
      const value = rest.slice(spaceIdx + 1).trim();
      db.prepare('INSERT OR REPLACE INTO knowledge (key, value) VALUES (?, ?)').run(key, value);
      await bot.sendMessage(chatId, `🏛 Stored: *${key}* (${value.length} chars)`, { parse_mode: 'Markdown' });
      return;
    }

    // palace search <query> — search across all rooms
    if (text.startsWith('palace search ')) {
      const query = text.slice(14).trim();
      const rows = db.prepare("SELECT key, value FROM knowledge WHERE key LIKE ? OR value LIKE ? ORDER BY key LIMIT 10")
        .all('%' + query + '%', '%' + query + '%');

      if (rows.length === 0) {
        await bot.sendMessage(chatId, `No results for "${query}".`);
        return;
      }

      const lines = rows.map(r => {
        const snippet = r.value.slice(0, 100).replace(/\n/g, ' ');
        return `• *${r.key}*\n  ${snippet}...`;
      });

      await bot.sendMessage(chatId, `🔍 *Palace Search: "${query}"*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown' });
      return;
    }
  });

  console.log('✅ MemPalace browser active — /palace, /palace <room>, palace store, palace search');
}

module.exports = { setupPalace };
