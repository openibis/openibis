// aria-ingest.js — Master ingestion pipeline for Aria
// Accepts any file type, strips PII, extracts patterns/knowledge,
// categorizes into business domains, stores clean data, updates Sofia's response library.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

const LIBRARY_DIR = path.join(__dirname, 'aria-library');
const INBOX_DIR = path.join(__dirname, 'aria-inbox');
const SUPPORTED_EXT = ['.txt', '.pdf', '.csv', '.eml', '.html', '.htm', '.docx', '.md'];

const CATEGORIES = [
  'pricing',       // rates, cost discussions, payment terms, insurance
  'intake',        // new client onboarding, assessments, initial calls
  'objections',    // pushback handling, concerns, hesitations
  'empathy',       // emotional support, rapport, compassionate language
  'compliance',    // regulations, HIPAA, DOH, legal, documentation
  'operations',    // scheduling, staffing, logistics, coordination
];

// ── File extractors ─────────────────────────────────────────────

function extractTxt(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function extractPdf(filePath) {
  return execSync(`python3 ${__dirname}/pdf_get.py "${filePath}"`).toString().trim();
}

function extractCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  // Convert CSV rows to readable text, skip empty lines
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length === 0) return '';
  const header = lines[0];
  // Return as structured text so the LLM can parse it
  return `[CSV Data — columns: ${header}]\n${lines.slice(1, 200).join('\n')}`;
}

function extractEml(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  // Parse basic email structure: strip headers down to subject, extract body
  const headerEnd = raw.indexOf('\n\n');
  const headers = headerEnd > 0 ? raw.slice(0, headerEnd) : '';
  const body = headerEnd > 0 ? raw.slice(headerEnd + 2) : raw;
  const subject = (headers.match(/^Subject:\s*(.+)$/mi) || [])[1] || '';
  return `[Email — Subject: ${subject}]\n${body}`;
}

function extractHtml(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  // Strip tags, decode entities, collapse whitespace
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDocx(filePath) {
  // Use python-docx via a quick inline script
  const script = `
import sys
try:
    from docx import Document
    doc = Document(sys.argv[1])
    print('\\n'.join([p.text for p in doc.paragraphs if p.text.strip()]))
except Exception as e:
    # Fallback: try unzipping and reading the XML
    import zipfile, re
    with zipfile.ZipFile(sys.argv[1]) as z:
        xml = z.read('word/document.xml').decode('utf-8')
        text = re.sub(r'<[^>]+>', ' ', xml)
        print(' '.join(text.split())[:8000])
`;
  return execSync(`python3 -c ${JSON.stringify(script)} "${filePath}"`).toString().trim();
}

const EXTRACTORS = {
  '.txt': extractTxt, '.md': extractTxt,
  '.pdf': extractPdf,
  '.csv': extractCsv,
  '.eml': extractEml,
  '.html': extractHtml, '.htm': extractHtml,
  '.docx': extractDocx,
};

// ── PII stripping ───────────────────────────────────────────────

function stripPII(text) {
  let clean = text;

  // Phone numbers: (xxx) xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, +1xxxxxxxxxx
  clean = clean.replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[PHONE]');

  // Email addresses
  clean = clean.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');

  // SSN patterns
  clean = clean.replace(/\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, '[SSN]');

  // Street addresses (number + street name pattern)
  clean = clean.replace(/\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Rd|Road|Ct|Court|Way|Pl|Place)\.?\b/gi, '[ADDRESS]');

  // Dates of birth in common formats
  clean = clean.replace(/\b(?:DOB|Date of Birth|Born|birthday)[:\s]*\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/gi, '[DOB]');

  // Medicare/Medicaid IDs (common patterns)
  clean = clean.replace(/\b(?:Medicare|Medicaid|MBI|HIC)[#:\s]*[A-Z0-9]{4,15}\b/gi, '[GOVT_ID]');

  // Names — use a conservative approach: strip "Patient:", "Client:", "Caregiver:" labeled names
  clean = clean.replace(/(?:Patient|Client|Caregiver|Family|Contact|Nurse|Aide|Name)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g, (match, name) => {
    return match.replace(name, '[NAME]');
  });

  // "Dear <Name>" and "Hi <Name>" patterns
  clean = clean.replace(/(?:Dear|Hi|Hello|Hey)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g, (match, name) => {
    return match.replace(name, '[NAME]');
  });

  // Signature blocks: lines starting with common sign-off patterns followed by a name
  clean = clean.replace(/(?:Sincerely|Regards|Best|Thanks|Warmly|Respectfully)[,\s]*\n\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g, (match, name) => {
    return match.replace(name, '[NAME]');
  });

  return clean;
}

// ── Chunking ────────────────────────────────────────────────────

function chunkText(text, maxSize = 600) {
  const chunks = [];
  const paragraphs = text.split(/\n\s*\n/);
  let current = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > maxSize && current) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // If chunks are still too large, split by sentences
  const result = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxSize) {
      result.push(chunk);
    } else {
      const sentences = chunk.split(/(?<=[.!?])\s+/);
      let sub = '';
      for (const s of sentences) {
        if ((sub + ' ' + s).length > maxSize && sub) {
          result.push(sub.trim());
          sub = s;
        } else {
          sub += (sub ? ' ' : '') + s;
        }
      }
      if (sub.trim()) result.push(sub.trim());
    }
  }

  return result;
}

// ── Core pipeline ───────────────────────────────────────────────

async function ingestFile(filePath, callModel, SYSTEM) {
  const ext = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);
  const extractor = EXTRACTORS[ext];

  if (!extractor) {
    return { filename, error: `Unsupported: ${ext}. Supported: ${SUPPORTED_EXT.join(', ')}` };
  }

  // 1. Extract raw text
  let raw;
  try {
    raw = extractor(filePath);
  } catch(e) {
    return { filename, error: `Extract failed: ${e.message}` };
  }

  if (!raw || raw.length < 30) {
    return { filename, error: 'File empty or too short' };
  }

  // 2. Strip PII
  const clean = stripPII(raw);

  // 3. Extract patterns and knowledge via LLM
  const extraction = await callModel('long', [{
    role: 'user',
    content: `You are a knowledge extraction engine for a home care business. Extract ONLY reusable patterns, phrases, approaches, and knowledge from this text. Never judge the content.

EXTRACT:
- Exact phrases and scripts that work well (quote them)
- Persuasion/sales patterns and techniques
- Objection handling approaches
- Empathetic language patterns
- Compliance procedures or checklists
- Pricing strategies or rate discussions
- Intake assessment questions or flows
- Operational procedures

IGNORE:
- Specific names, dates, case details (already redacted)
- One-time events that aren't reusable
- Administrative noise

Format each extracted item as:
CATEGORY: <pricing|intake|objections|empathy|compliance|operations>
TYPE: <phrase|script|pattern|procedure|checklist|technique>
CONTENT: <the extracted knowledge>
---

Text to analyze:
${clean.slice(0, 4000)}`
  }], SYSTEM);

  // 4. Parse extracted items
  const items = [];
  const blocks = extraction.split('---').filter(b => b.trim());
  for (const block of blocks) {
    const catMatch = block.match(/CATEGORY:\s*(\w+)/i);
    const typeMatch = block.match(/TYPE:\s*(\w+)/i);
    const contentMatch = block.match(/CONTENT:\s*([\s\S]*?)(?=\n(?:CATEGORY|TYPE|$))/i);

    if (catMatch && contentMatch) {
      const category = catMatch[1].toLowerCase();
      const type = typeMatch ? typeMatch[1].toLowerCase() : 'pattern';
      const content = contentMatch[1].trim();
      if (content.length > 10 && CATEGORIES.includes(category)) {
        items.push({ category, type, content });
      }
    }
  }

  // 5. Store in aria-library/ as structured JSON files (one per category)
  const db = new Database(path.join(__dirname, 'ibis_memory.db'));
  db.exec(`CREATE TABLE IF NOT EXISTS aria_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_file TEXT,
    category TEXT,
    type TEXT,
    content TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  const insert = db.prepare('INSERT INTO aria_knowledge (source_file, category, type, content) VALUES (?, ?, ?, ?)');
  let stored = 0;
  for (const item of items) {
    insert.run(filename, item.category, item.type, item.content);
    stored++;
  }

  // 6. Also chunk and store in ChromaDB for semantic search
  const chunks = chunkText(clean, 600);
  let chromaStored = 0;
  for (let i = 0; i < chunks.length; i++) {
    const key = `aria::${filename}::chunk_${i}`;
    const tags = items.length > 0
      ? [...new Set(items.map(it => it.category))].join(',')
      : 'uncategorized';
    try {
      execSync(`python3 ${__dirname}/memory_palace.py store ${JSON.stringify(key)} ${JSON.stringify(chunks[i].slice(0, 1000))} ${JSON.stringify(tags)}`);
      chromaStored++;
    } catch(e) { /* skip */ }
  }

  // 7. Write category summary files to aria-library/
  for (const cat of CATEGORIES) {
    const catItems = items.filter(it => it.category === cat);
    if (catItems.length === 0) continue;
    const catFile = path.join(LIBRARY_DIR, `${cat}.jsonl`);
    const lines = catItems.map(it => JSON.stringify({
      source: filename,
      type: it.type,
      content: it.content,
      ts: Date.now()
    }));
    fs.appendFileSync(catFile, lines.join('\n') + '\n');
  }

  return {
    filename,
    extracted: items.length,
    categories: [...new Set(items.map(it => it.category))],
    chromaChunks: chromaStored,
    error: null,
  };
}

// ── Bulk pipeline ───────────────────────────────────────────────

async function runBulkIngest(callModel, SYSTEM, notifyFn) {
  if (!fs.existsSync(INBOX_DIR)) fs.mkdirSync(INBOX_DIR, { recursive: true });
  if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR, { recursive: true });

  const files = fs.readdirSync(INBOX_DIR).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return SUPPORTED_EXT.includes(ext);
  });

  if (files.length === 0) return { processed: 0, message: 'No files in aria-inbox/.' };

  const results = [];
  for (const f of files) {
    const filePath = path.join(INBOX_DIR, f);
    if (notifyFn) await notifyFn(`Processing: ${f}`);
    const result = await ingestFile(filePath, callModel, SYSTEM);
    results.push(result);

    // Move processed file to aria-library/originals/
    const origDir = path.join(LIBRARY_DIR, 'originals');
    if (!fs.existsSync(origDir)) fs.mkdirSync(origDir, { recursive: true });
    try {
      fs.renameSync(filePath, path.join(origDir, f));
    } catch(e) {
      // Cross-device move fallback
      fs.copyFileSync(filePath, path.join(origDir, f));
      fs.unlinkSync(filePath);
    }
  }

  return { processed: results.length, results };
}

// ── Sofia response library builder ──────────────────────────────

async function buildSofiaLibrary(callModel, SYSTEM) {
  const db = new Database(path.join(__dirname, 'ibis_memory.db'));

  // Gather all extracted knowledge by category
  const library = {};
  for (const cat of CATEGORIES) {
    const rows = db.prepare('SELECT content, type FROM aria_knowledge WHERE category = ? ORDER BY created_at DESC LIMIT 50').all(cat);
    if (rows.length > 0) {
      library[cat] = rows;
    }
  }

  if (Object.keys(library).length === 0) return 'No knowledge extracted yet.';

  // Build a structured prompt library for Sofia
  const sections = [];
  for (const [cat, rows] of Object.entries(library)) {
    const items = rows.map(r => `[${r.type}] ${r.content}`).join('\n');
    sections.push(`## ${cat.toUpperCase()}\n${items}`);
  }

  const sofiaPrompt = await callModel('long', [{
    role: 'user',
    content: `You are building a response library for Sofia Elmer, an AI agent who handles home care client communication.
From these extracted knowledge items, compile a concise RESPONSE PLAYBOOK that Sofia can reference during conversations.

Organize by situation type. For each entry include:
- SITUATION: when to use this
- RESPONSE: the exact phrase or approach
- WHY: why it works

Keep the best 5-8 entries per category. Prioritize scripts and phrases that are ready to use.

Knowledge base:
${sections.join('\n\n').slice(0, 4000)}`
  }], SYSTEM);

  // Write Sofia's playbook
  const playbookPath = path.join(LIBRARY_DIR, 'sofia-playbook.md');
  fs.writeFileSync(playbookPath, `# Sofia's Response Playbook\n_Auto-generated by Aria Ingestion Pipeline — ${new Date().toISOString()}_\n\n${sofiaPrompt}`);

  // Store in ChromaDB for runtime retrieval
  try {
    execSync(`python3 ${__dirname}/memory_palace.py store "sofia_playbook" ${JSON.stringify(sofiaPrompt.slice(0, 2000))} "sofia,playbook,responses,homecare"`);
  } catch(e) { /* skip */ }

  return sofiaPrompt;
}

// ── Telegram integration + nightly schedule ─────────────────────

function setupAriaIngest(bot, chatId, callModel, SYSTEM) {
  if (!fs.existsSync(INBOX_DIR)) fs.mkdirSync(INBOX_DIR, { recursive: true });
  if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR, { recursive: true });

  // Handle file uploads via Telegram
  bot.on('document', async (msg) => {
    if (msg.chat.id !== chatId) return;
    const doc = msg.document;
    const ext = path.extname(doc.file_name || '').toLowerCase();

    if (!SUPPORTED_EXT.includes(ext)) {
      await bot.sendMessage(chatId, `Unsupported file type: ${ext}\nSupported: ${SUPPORTED_EXT.join(', ')}`);
      return;
    }

    try {
      // Download file from Telegram
      const fileLink = await bot.getFileLink(doc.file_id);
      const axios = require('axios');
      const resp = await axios.get(fileLink, { responseType: 'arraybuffer', timeout: 30000 });
      const savePath = path.join(INBOX_DIR, doc.file_name);
      fs.writeFileSync(savePath, resp.data);

      await bot.sendChatAction(chatId, 'typing');
      const result = await ingestFile(savePath, callModel, SYSTEM);

      // Move to originals
      const origDir = path.join(LIBRARY_DIR, 'originals');
      if (!fs.existsSync(origDir)) fs.mkdirSync(origDir, { recursive: true });
      try { fs.renameSync(savePath, path.join(origDir, doc.file_name)); }
      catch(e) { fs.copyFileSync(savePath, path.join(origDir, doc.file_name)); fs.unlinkSync(savePath); }

      if (result.error) {
        await bot.sendMessage(chatId, `Aria ingest error: ${result.error}`);
      } else {
        const cats = result.categories.length > 0 ? result.categories.join(', ') : 'none detected';
        await bot.sendMessage(chatId,
          `🔮 *Aria Ingested: ${result.filename}*\n\n` +
          `Extracted: ${result.extracted} knowledge items\n` +
          `Categories: ${cats}\n` +
          `ChromaDB chunks: ${result.chromaChunks}\n\n` +
          `PII stripped. Clean data stored.`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch(e) {
      await bot.sendMessage(chatId, 'Aria file download error: ' + e.message);
    }
  });

  // Commands
  bot.on('message', async (msg) => {
    if (msg.chat.id !== chatId) return;
    const text = (msg.text || '').trim();

    // Bulk ingest from aria-inbox/
    if (text === '/aria-ingest' || text === 'aria pipeline') {
      await bot.sendMessage(chatId, '🔮 *Aria Pipeline starting...*', { parse_mode: 'Markdown' });
      const result = await runBulkIngest(callModel, SYSTEM, async (status) => {
        await bot.sendChatAction(chatId, 'typing');
      });

      if (result.processed === 0) {
        await bot.sendMessage(chatId, '🔮 No files in aria-inbox/. Drop files there or send them here.');
        return;
      }

      const lines = result.results.map(r => {
        if (r.error) return `❌ ${r.filename}: ${r.error}`;
        return `✅ ${r.filename}: ${r.extracted} items → ${r.categories.join(', ') || 'uncategorized'}`;
      });

      await bot.sendMessage(chatId,
        `🔮 *Aria Pipeline Complete*\n\n${lines.join('\n')}\n\nUpdating Sofia's playbook...`,
        { parse_mode: 'Markdown' }
      );

      // Rebuild Sofia library after bulk ingest
      const playbook = await buildSofiaLibrary(callModel, SYSTEM);
      await bot.sendMessage(chatId,
        `📖 *Sofia Playbook Updated*\n\n${playbook.slice(0, 3000)}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // View category contents
    if (text.startsWith('/aria-cat ')) {
      const cat = text.slice(10).trim().toLowerCase();
      if (!CATEGORIES.includes(cat)) {
        await bot.sendMessage(chatId, `Unknown category. Options: ${CATEGORIES.join(', ')}`);
        return;
      }
      const catFile = path.join(LIBRARY_DIR, `${cat}.jsonl`);
      if (!fs.existsSync(catFile)) {
        await bot.sendMessage(chatId, `No data yet for category: ${cat}`);
        return;
      }
      const lines = fs.readFileSync(catFile, 'utf8').trim().split('\n').slice(-10);
      const items = lines.map(l => {
        try { const d = JSON.parse(l); return `• [${d.type}] ${d.content.slice(0, 150)}`; }
        catch(e) { return ''; }
      }).filter(Boolean);
      await bot.sendMessage(chatId,
        `🔮 *Aria — ${cat.toUpperCase()}* (last 10)\n\n${items.join('\n')}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Rebuild Sofia playbook on demand
    if (text === '/sofia-playbook' || text === 'rebuild sofia') {
      await bot.sendChatAction(chatId, 'typing');
      const playbook = await buildSofiaLibrary(callModel, SYSTEM);
      await bot.sendMessage(chatId,
        `📖 *Sofia Playbook*\n\n${playbook.slice(0, 3500)}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Show pipeline stats
    if (text === '/aria-stats') {
      const db = new Database(path.join(__dirname, 'ibis_memory.db'));
      db.exec(`CREATE TABLE IF NOT EXISTS aria_knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_file TEXT, category TEXT, type TEXT, content TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      )`);
      const total = db.prepare('SELECT COUNT(*) as cnt FROM aria_knowledge').get().cnt;
      const byCat = db.prepare('SELECT category, COUNT(*) as cnt FROM aria_knowledge GROUP BY category ORDER BY cnt DESC').all();
      const byType = db.prepare('SELECT type, COUNT(*) as cnt FROM aria_knowledge GROUP BY type ORDER BY cnt DESC LIMIT 6').all();
      const sources = db.prepare('SELECT DISTINCT source_file FROM aria_knowledge').all().length;
      const inboxCount = fs.existsSync(INBOX_DIR) ? fs.readdirSync(INBOX_DIR).filter(f => SUPPORTED_EXT.includes(path.extname(f).toLowerCase())).length : 0;

      const catLines = byCat.map(r => `  ${r.category}: ${r.cnt}`).join('\n');
      const typeLines = byType.map(r => `  ${r.type}: ${r.cnt}`).join('\n');

      await bot.sendMessage(chatId,
        `🔮 *Aria Pipeline Stats*\n\n` +
        `Total items: ${total}\n` +
        `Source files: ${sources}\n` +
        `Inbox pending: ${inboxCount}\n\n` +
        `*By category:*\n${catLines || '  (none yet)'}\n\n` +
        `*By type:*\n${typeLines || '  (none yet)'}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
  });

  // Nightly pipeline run at 2:30am (before AutoDream at 3am)
  setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 2 && now.getMinutes() === 30) {
      const inboxFiles = fs.existsSync(INBOX_DIR)
        ? fs.readdirSync(INBOX_DIR).filter(f => SUPPORTED_EXT.includes(path.extname(f).toLowerCase()))
        : [];

      if (inboxFiles.length > 0) {
        await bot.sendMessage(chatId, `🔮 *Aria nightly ingest — ${inboxFiles.length} files*`, { parse_mode: 'Markdown' });
        await runBulkIngest(callModel, SYSTEM);
        await buildSofiaLibrary(callModel, SYSTEM);
        await bot.sendMessage(chatId, '🔮 Nightly ingest complete. Sofia playbook updated.');
      }
    }
  }, 60 * 1000);

  console.log('✅ Aria Ingest Pipeline active — send files, /aria-ingest, /aria-stats, nightly at 2:30am');
}

module.exports = { setupAriaIngest, ingestFile, runBulkIngest, buildSofiaLibrary, stripPII, CATEGORIES };
