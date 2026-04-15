const fs = require('fs');
const https = require('https');
const OUTBOX = __dirname + '/outbox.json';
const RETRY = __dirname + '/retry.json';

function loadFile(path) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch(e) { return []; }
}
function saveFile(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}
function isOnline() {
  return new Promise(resolve => {
    const req = https.get('https://openrouter.ai', res => resolve(true));
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}
function enqueue(chatId, text) {
  const q = loadFile(OUTBOX);
  q.push({ chatId, text, ts: Date.now(), attempts: 0 });
  saveFile(OUTBOX, q);
}
async function flush(bot) {
  const online = await isOnline();
  if (!online) return;
  const q = loadFile(OUTBOX);
  if (q.length === 0) return;
  const failed = [];
  for (const item of q) {
    try {
      await bot.sendMessage(item.chatId, item.text);
    } catch(e) {
      item.attempts = (item.attempts || 0) + 1;
      if (item.attempts < 5) failed.push(item);
    }
  }
  saveFile(OUTBOX, failed);
}
function setupQueue(bot) {
  setInterval(() => flush(bot), 2 * 60 * 1000);
  setTimeout(() => flush(bot), 5000);
  console.log('✅ Offline queue running — flushing every 2 minutes');
}

module.exports = { enqueue, flush, setupQueue };
