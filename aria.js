// aria.js — Aria agent: ingests NLP/hypnosis knowledge library into ChromaDB
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

function setupAria(bot, chatId, callModel, SYSTEM) {
  const db = new Database(path.join(__dirname, 'ibis_memory.db'));
  const LIBRARY_DIR = path.join(__dirname, 'aria-library');

  // Ensure library directory exists
  if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR);

  // Ensure aria index table
  db.exec(`CREATE TABLE IF NOT EXISTS aria_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT UNIQUE,
    title TEXT,
    category TEXT,
    chunks INTEGER,
    ingested_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  function chunkText(text, size = 500) {
    const chunks = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let current = '';
    for (const s of sentences) {
      if ((current + s).length > size && current) {
        chunks.push(current.trim());
        current = s;
      } else {
        current += ' ' + s;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  async function ingestFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath);
    let text = '';

    if (ext === '.txt' || ext === '.md') {
      text = fs.readFileSync(filePath, 'utf8');
    } else if (ext === '.pdf') {
      try {
        text = execSync(`python3 ${__dirname}/pdf_get.py ${filePath}`).toString().trim();
      } catch(e) { return `PDF extract failed: ${e.message}`; }
    } else {
      return `Unsupported format: ${ext}. Use .txt, .md, or .pdf`;
    }

    if (!text || text.length < 50) return `File too short or empty: ${filename}`;

    // Chunk and store in ChromaDB
    const chunks = chunkText(text, 500);
    let stored = 0;
    for (let i = 0; i < chunks.length; i++) {
      const key = `aria::${filename}::chunk_${i}`;
      const tags = 'nlp,hypnosis,aria,knowledge';
      try {
        execSync(`python3 ${__dirname}/memory_palace.py store ${JSON.stringify(key)} ${JSON.stringify(chunks[i])} ${JSON.stringify(tags)}`);
        stored++;
      } catch(e) { /* skip failed chunk */ }
    }

    // Index in SQLite
    const category = await callModel('fast', [{
      role: 'user',
      content: `Categorize this text in 1-2 words. Options: NLP techniques, hypnosis scripts, therapeutic frameworks, communication patterns, trance inductions, metaphors, anchoring, reframing, timeline therapy, parts integration, other.\n\nText: ${text.slice(0, 500)}`
    }], SYSTEM);

    db.prepare('INSERT INTO aria_index (filename, title, category, chunks) VALUES (?, ?, ?, ?) ON CONFLICT(filename) DO UPDATE SET category=excluded.category, chunks=excluded.chunks')
      .run(filename, filename.replace(ext, ''), category.trim().slice(0, 50), stored);

    return `Ingested: ${filename} — ${stored} chunks stored, category: ${category.trim().slice(0, 50)}`;
  }

  async function ariaSearch(query) {
    try {
      const result = execSync(`python3 ${__dirname}/memory_palace.py search ${JSON.stringify('aria ' + query)}`).toString().trim();
      return result.includes('No memories') ? '' : result;
    } catch(e) { return ''; }
  }

  bot.on('message', async (msg) => {
    if (msg.chat.id !== chatId) return;
    const text = (msg.text || '').trim();

    // /aria <query> — search NLP/hypnosis knowledge
    if (text.startsWith('/aria ')) {
      const query = text.slice(6).trim();
      await bot.sendChatAction(chatId, 'typing');
      const results = await ariaSearch(query);
      if (!results) {
        await bot.sendMessage(chatId, '🔮 No matching knowledge found. Ingest files with: aria ingest <filename>');
        return;
      }
      const response = await callModel('fast', [{
        role: 'user',
        content: `You are Aria, an NLP and hypnosis knowledge specialist. Based on these retrieved knowledge fragments, give Soul a clear, practical answer to: "${query}"\n\nKnowledge:\n${results.slice(0, 2000)}\n\nBe specific and actionable. Reference techniques by name.`
      }], SYSTEM);
      await bot.sendMessage(chatId, `🔮 *Aria — NLP Knowledge*\n\n${response}`, { parse_mode: 'Markdown' });
      return;
    }

    // aria ingest <filename> — ingest a file from aria-library/
    if (text.startsWith('aria ingest ')) {
      const filename = text.slice(12).trim();
      const filePath = path.join(LIBRARY_DIR, filename);
      if (!fs.existsSync(filePath)) {
        await bot.sendMessage(chatId, `File not found: ${filePath}\nPlace files in aria-library/ folder.`);
        return;
      }
      await bot.sendChatAction(chatId, 'typing');
      const result = await ingestFile(filePath);
      await bot.sendMessage(chatId, `🔮 ${result}`);
      return;
    }

    // aria ingest all — bulk ingest everything in aria-library/
    if (text === 'aria ingest all') {
      const files = fs.readdirSync(LIBRARY_DIR).filter(f => /\.(txt|md|pdf)$/i.test(f));
      if (files.length === 0) {
        await bot.sendMessage(chatId, '🔮 No files found in aria-library/. Place .txt, .md, or .pdf files there.');
        return;
      }
      await bot.sendMessage(chatId, `🔮 Ingesting ${files.length} files...`);
      const results = [];
      for (const f of files) {
        const r = await ingestFile(path.join(LIBRARY_DIR, f));
        results.push(r);
      }
      await bot.sendMessage(chatId, `🔮 *Aria Bulk Ingest Complete*\n\n${results.join('\n')}`, { parse_mode: 'Markdown' });
      return;
    }

    // /aria-library — list ingested files
    if (text === '/aria-library' || text === '/aria-index') {
      const indexed = db.prepare('SELECT filename, category, chunks FROM aria_index ORDER BY ingested_at DESC').all();
      if (indexed.length === 0) {
        await bot.sendMessage(chatId, '🔮 No files ingested yet. Place files in aria-library/ and say `aria ingest all`.');
        return;
      }
      const lines = indexed.map(r => `• *${r.filename}* — ${r.category} (${r.chunks} chunks)`);
      await bot.sendMessage(chatId, `🔮 *Aria Knowledge Library*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
      return;
    }
  });

  console.log('✅ Aria active — /aria <query>, aria ingest <file>, /aria-library');
}

module.exports = { setupAria };
