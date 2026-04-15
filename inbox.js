// inbox.js — auto-file anything Soul pastes into Telegram
const Database = require('better-sqlite3');

function setupInbox(bot, chatId, callModel, SYSTEM) {
  const db = new Database(require('path').join(__dirname, 'ibis_memory.db'));

  // Trigger: message starts with "dump:" or "note:" or "inbox:"
  bot.on('message', async (msg) => {
    if (msg.chat.id !== chatId) return;
    const text = (msg.text || '').trim();
    
    const triggers = ['dump:', 'note:', 'inbox:', 'log:', 'file:'];
    const matched = triggers.find(t => text.toLowerCase().startsWith(t));
    if (!matched) return;
    msg.ibis_handled = true;

    const content = text.slice(matched.length).trim();
    if (!content) return;

    // Ask IBIS to auto-tag it
    const tagPrompt = `You are a memory filing system. Given this note from Soul, generate:
1. A short snake_case key (max 5 words, no spaces)
2. 2-3 relevant tags

Note: "${content}"

Reply in this exact format:
KEY: your_key_here
TAGS: tag1, tag2, tag3`;

    const tagged = await callModel('fast', [{role:'user', content: tagPrompt}], SYSTEM);
    
    const keyMatch = tagged.match(/KEY:\s*(.+)/);
    const tagsMatch = tagged.match(/TAGS:\s*(.+)/);
    const key = keyMatch ? keyMatch[1].trim().toLowerCase().replace(/\s+/g,'_') : 'note_' + Date.now();
    const tags = tagsMatch ? tagsMatch[1].trim() : 'general';
    const stored = `${content}\n[tags: ${tags}]\n[filed: ${new Date().toISOString()}]`;

    db.prepare('INSERT INTO knowledge (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, stored);

    await bot.sendMessage(chatId, `🗂 *Filed to memory*\n\n*Key:* \`${key}\`\n*Tags:* ${tags}\n\n✅ Stored.`, {parse_mode:'Markdown'});
  });

  console.log('✅ Inbox listener active — use dump: / note: / inbox: / log: / file:');
}

module.exports = { setupInbox };
