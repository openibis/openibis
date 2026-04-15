// autodream.js — AutoDream: smarter memory consolidation at 3am
// Phase 1: Deduplicate/archive stale memories
// Phase 2: Extract patterns from conversations
// Phase 3: Compress old message history
// Phase 4: Sync to semantic memory
// Phase 5: AutoMemory — detect themes, auto-create MemPalace rooms
const Database = require('better-sqlite3');
const path = require('path');
const { execSync } = require('child_process');

function setupAutoDream(bot, chatId, callModel, SYSTEM) {
  const db = new Database(path.join(__dirname, 'ibis_memory.db'));

  // Create palace_autolog table
  db.exec(`CREATE TABLE IF NOT EXISTS palace_autolog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_name TEXT,
    entries_created INTEGER,
    theme TEXT,
    signals TEXT,
    status TEXT DEFAULT 'pending',
    ts INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // Pending auto-rooms awaiting approval
  let pendingRooms = [];

  async function dreamCycle() {
    const startTime = Date.now();
    await bot.sendMessage(chatId, '💤 *AutoDream starting — memory consolidation cycle*', { parse_mode: 'Markdown' });

    const results = [];

    // Phase 1: Consolidate duplicate/similar memories
    try {
      const allMem = db.prepare('SELECT key, value FROM knowledge ORDER BY key').all();
      if (allMem.length > 10) {
        const memDump = allMem.map(r => `${r.key}: ${r.value.slice(0, 100)}`).join('\n');
        const consolidation = await callModel('reasoning', [{
          role: 'user',
          content: `You are a memory consolidation engine. Analyze these ${allMem.length} memory entries and identify:
1. DUPLICATES — entries that store the same information under different keys (list pairs to merge)
2. STALE — entries that are likely outdated or no longer relevant (list keys to archive)
3. GAPS — important topics that should be in memory but aren't (list 2-3 suggestions)

Memory entries:
${memDump.slice(0, 3000)}

Reply in this exact format:
DUPLICATES: key1=key2, key3=key4 (or NONE)
STALE: key1, key2, key3 (or NONE)
GAPS: description1, description2`
        }], SYSTEM);

        results.push('Phase 1 — Memory audit:\n' + consolidation.slice(0, 500));

        // Auto-archive stale entries
        const staleMatch = consolidation.match(/STALE:\s*(.+)/);
        if (staleMatch && !staleMatch[1].includes('NONE')) {
          const staleKeys = staleMatch[1].split(',').map(s => s.trim()).filter(Boolean);
          let archived = 0;
          for (const key of staleKeys.slice(0, 10)) {
            const exists = db.prepare('SELECT key FROM knowledge WHERE key = ?').get(key);
            if (exists) {
              db.prepare("UPDATE knowledge SET key = 'archived::' || key WHERE key = ?").run(key);
              archived++;
            }
          }
          if (archived > 0) results.push(`Archived ${archived} stale entries.`);
        }
      }
    } catch(e) { results.push('Phase 1 error: ' + e.message); }

    // Phase 2: Extract patterns from recent conversations
    try {
      const recentMsgs = db.prepare("SELECT role, content FROM messages ORDER BY ts DESC LIMIT 100").all();
      if (recentMsgs.length > 20) {
        const convo = recentMsgs.reverse().map(m => `${m.role}: ${m.content.slice(0, 200)}`).join('\n');
        const patterns = await callModel('reasoning', [{
          role: 'user',
          content: `Analyze these recent conversations between Soul and IBIS. Extract:
1. RECURRING_TOPICS — what Soul keeps asking about (max 5)
2. BEHAVIOR_PATTERNS — Soul's work patterns, peak times, preferences
3. INSIGHTS — non-obvious observations that would help serve Soul better
4. MOOD_TREND — overall energy/focus trend this period

Be concise, one line each.

Conversations:
${convo.slice(0, 3000)}`
        }], SYSTEM);

        results.push('Phase 2 — Pattern extraction:\n' + patterns.slice(0, 500));

        db.prepare('INSERT INTO knowledge (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
          .run('dream::patterns_' + new Date().toISOString().split('T')[0], patterns.slice(0, 1000));
      }
    } catch(e) { results.push('Phase 2 error: ' + e.message); }

    // Phase 3: Compress message history (keep last 200, summarize older)
    try {
      const total = db.prepare('SELECT COUNT(*) as cnt FROM messages').get().cnt;
      if (total > 300) {
        const old = db.prepare("SELECT role, content FROM messages ORDER BY ts ASC LIMIT 100").all();
        const summary = await callModel('fast', [{
          role: 'user',
          content: `Compress these ${old.length} messages into a 5-line summary preserving key decisions, commitments, and context:\n${old.map(m => m.role + ': ' + m.content.slice(0, 100)).join('\n').slice(0, 2000)}`
        }], SYSTEM);

        db.prepare('INSERT INTO knowledge (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
          .run('dream::history_compressed_' + Date.now(), summary);

        db.prepare("DELETE FROM messages WHERE id IN (SELECT id FROM messages ORDER BY ts ASC LIMIT 100)").run();
        results.push(`Phase 3 — Compressed ${old.length} old messages into summary.`);
      }
    } catch(e) { results.push('Phase 3 error: ' + e.message); }

    // Phase 4: Sync insights to semantic memory
    try {
      const dreamPatterns = db.prepare("SELECT key, value FROM knowledge WHERE key LIKE 'dream::%' ORDER BY key DESC LIMIT 3").all();
      for (const p of dreamPatterns) {
        execSync(`python3 ${__dirname}/memory_palace.py store ${JSON.stringify(p.key)} ${JSON.stringify(p.value.slice(0, 500))} "dream,consolidation,patterns"`);
      }
      results.push('Phase 4 — Synced to semantic memory.');
    } catch(e) { results.push('Phase 4 skip: ' + e.message); }

    // Phase 5: AutoMemory — detect themes, auto-create MemPalace rooms
    try {
      const autoMemResult = await autoMemoryPhase();
      if (autoMemResult) results.push(autoMemResult);
    } catch(e) { results.push('Phase 5 error: ' + e.message); }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const report = `💤 *AutoDream Complete* (${elapsed}s)\n\n${results.join('\n\n')}`;
    await bot.sendMessage(chatId, report.slice(0, 4000), { parse_mode: 'Markdown' });
  }

  // ── Phase 5: AutoMemory ─────────────────────────────────────

  async function autoMemoryPhase() {
    // 1. Gather last 24h of conversations + tasks
    const cutoff24h = Math.floor(Date.now() / 1000) - 86400;

    const recentMsgs = db.prepare(
      "SELECT role, content FROM messages WHERE ts > datetime(?, 'unixepoch') ORDER BY ts ASC"
    ).all(cutoff24h);

    let taskText = '';
    try {
      const recentTasks = db.prepare(
        "SELECT title, priority, status, context FROM tasks WHERE created_at > ? ORDER BY created_at DESC LIMIT 20"
      ).all(cutoff24h);
      if (recentTasks.length > 0) {
        taskText = '\n\nRecent tasks:\n' + recentTasks.map(t => `[${t.status}] P${t.priority}: ${t.title}`).join('\n');
      }
    } catch(e) { /* tasks table may not exist */ }

    if (recentMsgs.length < 5) {
      return 'Phase 5 — AutoMemory: Not enough conversation data (need 5+ messages in 24h).';
    }

    const convoText = recentMsgs.map(m => `${m.role}: ${m.content.slice(0, 200)}`).join('\n');

    // Get existing room names so we don't duplicate
    const existingRooms = db.prepare("SELECT DISTINCT key FROM knowledge WHERE key LIKE '%::%'").all()
      .map(r => r.key.split('::')[0]);
    const existingSet = [...new Set(existingRooms)];

    // 2. Ask LLM to detect emerging themes
    const analysis = await callModel('reasoning', [{
      role: 'user',
      content: `You are AutoMemory, a theme detection engine for a knowledge management system called MemPalace.

Analyze the last 24 hours of conversations and tasks. Identify EMERGING THEMES — topics that appear 3 or more times and represent a coherent knowledge area worth storing.

EXISTING ROOMS (do NOT recreate these): ${existingSet.join(', ')}

RULES:
- A theme needs 3+ distinct signals (separate mentions, questions, or tasks about the same topic)
- The theme must be distinct from existing rooms
- Only propose rooms that would be useful long-term, not one-off conversations
- Maximum 2 new rooms per cycle

For each theme found, provide:
THEME: <short_lowercase_name>
TITLE: <Human readable title>
SIGNALS: <list the 3+ specific signals that triggered this>
ENTRY_1_KEY: <room::subkey>
ENTRY_1_VALUE: <synthesized content for this entry, 200-400 chars>
ENTRY_2_KEY: <room::subkey>
ENTRY_2_VALUE: <synthesized content, 200-400 chars>
---

If no themes meet the 3-signal threshold, reply: NO_NEW_THEMES

Conversations (last 24h):
${convoText.slice(0, 3000)}${taskText}`
    }], SYSTEM);

    if (analysis.includes('NO_NEW_THEMES')) {
      return 'Phase 5 — AutoMemory: No emerging themes detected (3-signal threshold not met).';
    }

    // 3. Parse detected themes
    const themeBlocks = analysis.split('---').filter(b => b.includes('THEME:'));
    const newRooms = [];

    for (const block of themeBlocks.slice(0, 2)) {
      const themeMatch = block.match(/THEME:\s*(\S+)/);
      const titleMatch = block.match(/TITLE:\s*(.+)/);
      const signalsMatch = block.match(/SIGNALS:\s*(.+)/);

      if (!themeMatch) continue;

      const roomName = themeMatch[1].trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      const title = titleMatch ? titleMatch[1].trim() : roomName;
      const signals = signalsMatch ? signalsMatch[1].trim() : '';

      // NEVER modify existing rooms
      if (existingSet.includes(roomName)) continue;

      // Extract entries
      const entries = [];
      const entryPattern = /ENTRY_(\d+)_KEY:\s*(.+)\nENTRY_\1_VALUE:\s*([\s\S]*?)(?=ENTRY_|THEME:|$)/g;
      let match;
      while ((match = entryPattern.exec(block)) !== null) {
        const key = match[2].trim();
        const value = match[3].trim();
        if (key && value && value.length > 20) {
          // Ensure the key is prefixed with the room name
          const fullKey = key.includes('::') ? key : `${roomName}::${key}`;
          entries.push({ key: fullKey, value });
        }
      }

      // Fallback: try simpler parsing if regex didn't match
      if (entries.length === 0) {
        const keyMatches = [...block.matchAll(/ENTRY_\d+_KEY:\s*(.+)/g)];
        const valMatches = [...block.matchAll(/ENTRY_\d+_VALUE:\s*([\s\S]*?)(?=ENTRY_\d+_KEY|THEME:|---|\s*$)/g)];
        for (let i = 0; i < Math.min(keyMatches.length, valMatches.length); i++) {
          const key = keyMatches[i][1].trim();
          const value = valMatches[i][1].trim();
          if (key && value && value.length > 20) {
            const fullKey = key.includes('::') ? key : `${roomName}::${key}`;
            entries.push({ key: fullKey, value });
          }
        }
      }

      if (entries.length > 0) {
        newRooms.push({ roomName, title, signals, entries });
      }
    }

    if (newRooms.length === 0) {
      return 'Phase 5 — AutoMemory: Themes detected but could not parse entries.';
    }

    // 4. Store entries (additive only) and log
    const created = [];
    for (const room of newRooms) {
      for (const entry of room.entries) {
        db.prepare('INSERT OR REPLACE INTO knowledge (key, value) VALUES (?, ?)').run(entry.key, entry.value);
      }

      // Log to palace_autolog
      db.prepare('INSERT INTO palace_autolog (room_name, entries_created, theme, signals, status) VALUES (?, ?, ?, ?, ?)')
        .run(room.roomName, room.entries.length, room.title, room.signals, 'pending');

      // Track for approval UI
      const logId = db.prepare('SELECT last_insert_rowid() as id').get().id;
      pendingRooms.push({ id: logId, ...room });

      created.push(`${room.roomName} (${room.entries.length} entries)`);

      // 5. Send Telegram notification with approval options
      const entryList = room.entries.map(e => `  • \`${e.key}\``).join('\n');
      await bot.sendMessage(chatId,
        `🧠 *AutoMemory — New Room Detected*\n\n` +
        `Room: *${room.roomName}*\n` +
        `Title: ${room.title}\n` +
        `Signals: ${room.signals.slice(0, 200)}\n\n` +
        `Entries created:\n${entryList}\n\n` +
        `Actions:\n` +
        `\`/approve ${room.roomName}\` — keep this room\n` +
        `\`/rename ${room.roomName} newname\` — rename it\n` +
        `\`/delete-room ${room.roomName}\` — remove it`,
        { parse_mode: 'Markdown' }
      );
    }

    return `Phase 5 — AutoMemory: Created ${created.length} new room(s): ${created.join(', ')}`;
  }

  // ── Approval commands ───────────────────────────────────────

  bot.on('message', async (msg) => {
    if (msg.chat.id !== chatId) return;
    const text = (msg.text || '').trim();

    // /dream — manual trigger
    if (text.toLowerCase() === '/dream' || text.toLowerCase() === 'dream now') {
      await dreamCycle();
      return;
    }

    // /approve <room> — mark auto-created room as approved
    if (text.startsWith('/approve ')) {
      const roomName = text.slice(9).trim().toLowerCase();
      const log = db.prepare("SELECT id FROM palace_autolog WHERE room_name = ? AND status = 'pending' ORDER BY ts DESC LIMIT 1").get(roomName);
      if (log) {
        db.prepare("UPDATE palace_autolog SET status = 'approved' WHERE id = ?").run(log.id);
        pendingRooms = pendingRooms.filter(r => r.roomName !== roomName);
        await bot.sendMessage(chatId, `✅ Room *${roomName}* approved and permanent.`, { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, `No pending room "${roomName}" to approve.`);
      }
      return;
    }

    // /rename <oldroom> <newroom> — rename an auto-created room
    if (text.startsWith('/rename ')) {
      const parts = text.slice(8).trim().split(/\s+/);
      if (parts.length < 2) {
        await bot.sendMessage(chatId, 'Usage: `/rename oldname newname`', { parse_mode: 'Markdown' });
        return;
      }
      const [oldName, newName] = [parts[0].toLowerCase(), parts[1].toLowerCase()];

      // Get all entries in the old room
      const entries = db.prepare("SELECT key, value FROM knowledge WHERE key LIKE ?").all(oldName + '::%');
      if (entries.length === 0) {
        await bot.sendMessage(chatId, `Room "${oldName}" not found or empty.`);
        return;
      }

      // Create new entries, remove old
      for (const e of entries) {
        const newKey = e.key.replace(oldName + '::', newName + '::');
        db.prepare('INSERT OR REPLACE INTO knowledge (key, value) VALUES (?, ?)').run(newKey, e.value);
        db.prepare('DELETE FROM knowledge WHERE key = ?').run(e.key);
      }

      // Update autolog
      db.prepare("UPDATE palace_autolog SET room_name = ?, status = 'approved' WHERE room_name = ? AND status = 'pending'")
        .run(newName, oldName);

      pendingRooms = pendingRooms.filter(r => r.roomName !== oldName);
      await bot.sendMessage(chatId, `✅ Room renamed: *${oldName}* → *${newName}* (${entries.length} entries moved)`, { parse_mode: 'Markdown' });
      return;
    }

    // /delete-room <room> — remove an auto-created room (only pending ones)
    if (text.startsWith('/delete-room ')) {
      const roomName = text.slice(13).trim().toLowerCase();

      // Safety: only delete rooms that are still pending in autolog
      const log = db.prepare("SELECT id FROM palace_autolog WHERE room_name = ? AND status = 'pending' ORDER BY ts DESC LIMIT 1").get(roomName);
      if (!log) {
        await bot.sendMessage(chatId, `Room "${roomName}" is not a pending auto-created room. Manual rooms cannot be deleted this way.`);
        return;
      }

      const entries = db.prepare("SELECT key FROM knowledge WHERE key LIKE ?").all(roomName + '::%');
      for (const e of entries) {
        db.prepare('DELETE FROM knowledge WHERE key = ?').run(e.key);
      }

      db.prepare("UPDATE palace_autolog SET status = 'deleted' WHERE id = ?").run(log.id);
      pendingRooms = pendingRooms.filter(r => r.roomName !== roomName);
      await bot.sendMessage(chatId, `🗑 Room *${roomName}* deleted (${entries.length} entries removed).`, { parse_mode: 'Markdown' });
      return;
    }

    // /autolog — show auto-created room history
    if (text === '/autolog') {
      const logs = db.prepare('SELECT room_name, entries_created, theme, status, ts FROM palace_autolog ORDER BY ts DESC LIMIT 15').all();
      if (logs.length === 0) {
        await bot.sendMessage(chatId, '🧠 No auto-created rooms yet. AutoMemory runs at 3am or during /dream.');
        return;
      }
      const icons = { pending: '⏳', approved: '✅', deleted: '🗑', renamed: '✏️' };
      const lines = logs.map(l => {
        const time = new Date(l.ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `${icons[l.status] || '📋'} ${time} — *${l.room_name}* (${l.entries_created} entries) ${l.status}\n   ${(l.theme || '').slice(0, 60)}`;
      });
      await bot.sendMessage(chatId, `🧠 *AutoMemory Log*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown' });
      return;
    }
  });

  // Schedule: 3am nightly
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 3 && now.getMinutes() === 0) {
      dreamCycle();
    }
  }, 60 * 1000);

  console.log('✅ AutoDream active — memory consolidation + AutoMemory at 3am, or say /dream');
}

module.exports = { setupAutoDream };
