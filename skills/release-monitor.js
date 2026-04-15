const path = require('path');
const Database = require('better-sqlite3');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

// --- Config ---

const GITHUB_REPOS = [
  'openclaw/openclaw',
  'anthropics/anthropic-sdk-js',
];

const NPM_PACKAGES = [
  'groq-sdk',
  'chromadb',
  'better-sqlite3',
  'telegraf',
  'remotion',
];

const RELEVANCE_THRESHOLD = 7;

const SYSTEM_PROMPT = [
  'You score software releases for relevance to an AI agent system.',
  'The system is a Node.js Telegram bot that orchestrates sub-agents,',
  'uses Anthropic Claude for reasoning, SQLite for state, Playwright for browsing,',
  'and manages home care businesses.',
  '',
  'Given a release name, version, and description, respond with ONLY a JSON object:',
  '{"score": <1-10>, "reason": "<one sentence>"}',
  '',
  'Score guide:',
  '  1-3: unrelated or cosmetic change',
  '  4-6: tangentially useful, minor improvement',
  '  7-8: directly relevant, meaningful capability or fix',
  '  9-10: critical upgrade, security fix, or major new capability',
].join('\n');

// --- Database ---

function openDb() {
  const dbPath = path.join(__dirname, '..', 'memory', 'ibis.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS release_monitor (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      summary TEXT,
      score INTEGER,
      reason TEXT,
      notified INTEGER DEFAULT 0,
      seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source, name, version)
    )
  `);
  return db;
}

// --- GitHub releases ---

async function fetchGitHubReleases(repo) {
  const url = `https://api.github.com/repos/${repo}/releases?per_page=5`;
  const headers = { 'User-Agent': 'openclaw-release-monitor', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  try {
    const res = await axios.get(url, { headers, timeout: 15000 });
    return res.data.map(r => ({
      source: 'github',
      name: repo,
      version: r.tag_name,
      summary: (r.name || '') + '\n' + (r.body || '').slice(0, 1500),
    }));
  } catch (err) {
    console.error(`[release-monitor] GitHub fetch failed for ${repo}: ${err.message}`);
    return [];
  }
}

// --- NPM releases ---

async function fetchNpmReleases(pkg) {
  const url = `https://registry.npmjs.org/${pkg}`;
  try {
    const res = await axios.get(url, { timeout: 15000, headers: { Accept: 'application/json' } });
    const times = res.data.time || {};
    const versions = Object.keys(times)
      .filter(v => v !== 'created' && v !== 'modified')
      .sort((a, b) => new Date(times[b]) - new Date(times[a]))
      .slice(0, 5);

    return versions.map(v => {
      const meta = (res.data.versions && res.data.versions[v]) || {};
      return {
        source: 'npm',
        name: pkg,
        version: v,
        summary: meta.description || pkg + ' ' + v,
      };
    });
  } catch (err) {
    console.error(`[release-monitor] NPM fetch failed for ${pkg}: ${err.message}`);
    return [];
  }
}

// --- Anthropic scoring ---

async function scoreRelease(claude, release) {
  const userMsg = [
    `Package: ${release.name}`,
    `Version: ${release.version}`,
    `Source: ${release.source}`,
    `Description: ${release.summary}`,
  ].join('\n');

  try {
    const res = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    });

    const text = res.content[0].text.trim();
    const parsed = JSON.parse(text);
    return { score: parsed.score, reason: parsed.reason };
  } catch (err) {
    console.error(`[release-monitor] Scoring failed for ${release.name}@${release.version}: ${err.message}`);
    return { score: 0, reason: 'scoring error' };
  }
}

// --- Telegram notification ---

async function notifyTelegram(bot, chatId, release) {
  const lines = [
    `[Release Monitor] ${release.source.toUpperCase()}: ${release.name} ${release.version}`,
    `Score: ${release.score}/10`,
    `${release.reason}`,
  ];
  try {
    await bot.sendMessage(chatId, lines.join('\n'));
  } catch (err) {
    console.error(`[release-monitor] Telegram send failed: ${err.message}`);
  }
}

// --- Main ---

async function runReleaseMonitor(options = {}) {
  const { bot, chatId, anthropicKey } = options;

  console.log('[release-monitor] Starting release scan...');

  const db = openDb();
  const claude = new Anthropic({ apiKey: anthropicKey || process.env.ANTHROPIC_KEY });

  const alreadySeen = db.prepare(
    'SELECT source, name, version FROM release_monitor'
  );
  const seenSet = new Set(alreadySeen.all().map(r => `${r.source}:${r.name}:${r.version}`));

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO release_monitor (source, name, version, summary, score, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const markNotified = db.prepare(
    'UPDATE release_monitor SET notified = 1 WHERE source = ? AND name = ? AND version = ?'
  );

  // Fetch all releases in parallel
  const githubPromises = GITHUB_REPOS.map(r => fetchGitHubReleases(r));
  const npmPromises = NPM_PACKAGES.map(p => fetchNpmReleases(p));
  const results = await Promise.all([...githubPromises, ...npmPromises]);
  const allReleases = results.flat();

  // Filter to new releases only
  const newReleases = allReleases.filter(r => !seenSet.has(`${r.source}:${r.name}:${r.version}`));

  console.log(`[release-monitor] Found ${allReleases.length} total, ${newReleases.length} new releases.`);

  let highScoreCount = 0;

  for (const release of newReleases) {
    const { score, reason } = await scoreRelease(claude, release);
    release.score = score;
    release.reason = reason;

    insertStmt.run(release.source, release.name, release.version, release.summary, score, reason);

    console.log(`[release-monitor] ${release.name}@${release.version} => ${score}/10: ${reason}`);

    if (score >= RELEVANCE_THRESHOLD && bot && chatId) {
      await notifyTelegram(bot, chatId, release);
      markNotified.run(release.source, release.name, release.version);
      highScoreCount++;
    }
  }

  db.close();
  console.log(`[release-monitor] Done. ${newReleases.length} scored, ${highScoreCount} notified.`);

  return { total: allReleases.length, new: newReleases.length, notified: highScoreCount };
}

module.exports = { runReleaseMonitor };
