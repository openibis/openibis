// news-miniapp.js — Telegram Mini App for news digest
const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const NEWSAPI_KEY = process.env.NEWSAPI_KEY || 'REPLACE_WITH_YOUR_NEWSAPI_KEY';
const PORT = process.env.NEWS_PORT || 3100;

const HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IBIS News Radar</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; background: var(--tg-theme-bg-color, #1a1a2e); color: var(--tg-theme-text-color, #e0e0e0); padding: 16px; }
  h1 { font-size: 20px; margin-bottom: 16px; color: var(--tg-theme-button-color, #6c63ff); }
  .tabs { display: flex; gap: 8px; margin-bottom: 16px; overflow-x: auto; }
  .tab { padding: 8px 16px; border-radius: 20px; background: var(--tg-theme-secondary-bg-color, #16213e); border: none; color: var(--tg-theme-text-color, #e0e0e0); cursor: pointer; white-space: nowrap; font-size: 14px; }
  .tab.active { background: var(--tg-theme-button-color, #6c63ff); color: var(--tg-theme-button-text-color, #fff); }
  .card { background: var(--tg-theme-secondary-bg-color, #16213e); border-radius: 12px; padding: 14px; margin-bottom: 12px; }
  .card h3 { font-size: 15px; margin-bottom: 6px; line-height: 1.3; }
  .card .source { font-size: 12px; color: #888; margin-bottom: 4px; }
  .card .desc { font-size: 13px; line-height: 1.4; color: #aaa; }
  .card a { color: var(--tg-theme-link-color, #6c9fff); text-decoration: none; }
  .loading { text-align: center; padding: 40px; color: #888; }
  .refresh { position: fixed; bottom: 20px; right: 20px; width: 50px; height: 50px; border-radius: 50%; background: var(--tg-theme-button-color, #6c63ff); border: none; color: white; font-size: 20px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
</style>
</head>
<body>
<h1>📡 IBIS News Radar</h1>
<div class="tabs">
  <button class="tab active" onclick="loadNews('home care industry')">Home Care</button>
  <button class="tab" onclick="loadNews('healthcare staffing')">Staffing</button>
  <button class="tab" onclick="loadNews('AI business automation')">AI/Tech</button>
  <button class="tab" onclick="loadNews('NJ healthcare regulation')">NJ Regs</button>
  <button class="tab" onclick="loadNews('TikTok business trends')">Trends</button>
</div>
<div id="feed"><div class="loading">Loading...</div></div>
<button class="refresh" onclick="loadNews()">↻</button>
<script>
  const tg = window.Telegram?.WebApp;
  if (tg) tg.expand();
  let currentTopic = 'home care industry';

  async function loadNews(topic) {
    if (topic) currentTopic = topic;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => { if (t.textContent.toLowerCase().includes(currentTopic.split(' ')[0])) t.classList.add('active'); });
    document.getElementById('feed').innerHTML = '<div class="loading">Loading...</div>';
    try {
      const res = await fetch('/api/news?q=' + encodeURIComponent(currentTopic));
      const data = await res.json();
      if (!data.articles || data.articles.length === 0) {
        document.getElementById('feed').innerHTML = '<div class="loading">No articles found.</div>';
        return;
      }
      document.getElementById('feed').innerHTML = data.articles.map(a =>
        '<div class="card">' +
        '<div class="source">' + (a.source?.name || '') + ' · ' + new Date(a.publishedAt).toLocaleDateString() + '</div>' +
        '<h3><a href="' + a.url + '" target="_blank">' + (a.title || '') + '</a></h3>' +
        '<div class="desc">' + (a.description || '').slice(0, 150) + '</div>' +
        '</div>'
      ).join('');
    } catch(e) {
      document.getElementById('feed').innerHTML = '<div class="loading">Error loading news.</div>';
    }
  }
  loadNews();
</script>
</body>
</html>`;

function startNewsServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/news')) {
      const url = new URL(req.url, 'http://localhost');
      const q = url.searchParams.get('q') || 'home care';
      try {
        const apiRes = await axios.get('https://newsapi.org/v2/everything', {
          params: { q, sortBy: 'publishedAt', pageSize: 15, apiKey: NEWSAPI_KEY, language: 'en' },
          timeout: 8000,
        });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ articles: apiRes.data.articles || [] }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message, articles: [] }));
      }
      return;
    }

    // Serve the mini app HTML
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML_TEMPLATE);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ News Mini App server running on port ${PORT}`);
  });

  return server;
}

function setupNewsMiniApp(bot, chatId) {
  bot.on('message', async (msg) => {
    if (msg.chat.id !== chatId) return;
    const text = (msg.text || '').trim();

    if (text === '/news') {
      await bot.sendMessage(chatId, '📡 *IBIS News Radar*\n\nOpen the mini app below to browse news:', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{
            text: '📡 Open News Radar',
            web_app: { url: `https://${process.env.NEWS_DOMAIN || 'YOUR_VPS_IP'}:${PORT}` }
          }]]
        }
      });
      return;
    }
  });

  // Start the HTTP server
  startNewsServer();

  console.log('✅ News Mini App active — /news to open');
}

module.exports = { setupNewsMiniApp, startNewsServer };
