// mcp-gcal.js — Google Calendar MCP integration for IBIS
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, 'gmail-credentials.json'); // shared OAuth creds
const TOKEN_PATH = path.join(__dirname, 'gcal-token.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events'];

function getAuth() {
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web || {};
  const oauth2 = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0]);
  if (fs.existsSync(TOKEN_PATH)) {
    oauth2.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
  }
  return oauth2;
}

async function listEvents(days = 1) {
  const auth = getAuth();
  if (!auth) return 'Google Calendar not configured. Run /gcal-setup.';
  const cal = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);
  const res = await cal.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  });
  return (res.data.items || []).map(e => ({
    summary: e.summary || '(no title)',
    start: e.start.dateTime || e.start.date,
    end: e.end.dateTime || e.end.date,
    location: e.location || '',
    description: (e.description || '').slice(0, 200),
  }));
}

async function createEvent(summary, startISO, endISO, description) {
  const auth = getAuth();
  if (!auth) return 'Google Calendar not configured.';
  const cal = google.calendar({ version: 'v3', auth });
  const event = {
    summary,
    start: { dateTime: startISO, timeZone: 'America/New_York' },
    end: { dateTime: endISO, timeZone: 'America/New_York' },
    description: description || '',
  };
  const res = await cal.events.insert({ calendarId: 'primary', resource: event });
  return `Event created: ${res.data.htmlLink}`;
}

function setupGcal(bot, chatId, callModel, SYSTEM) {
  bot.on('message', async (msg) => {
    if (msg.chat.id !== chatId) return;
    const text = (msg.text || '').trim();

    if (text === '/cal' || text === '/calendar') {
      try {
        const events = await listEvents(1);
        if (typeof events === 'string') { await bot.sendMessage(chatId, events); return; }
        if (events.length === 0) { await bot.sendMessage(chatId, '📅 No events today.'); return; }
        const lines = events.map(e => {
          const time = new Date(e.start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
          return `• *${time}* — ${e.summary}${e.location ? ' 📍 ' + e.location : ''}`;
        });
        await bot.sendMessage(chatId, `📅 *Today's Calendar*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
      } catch(e) { await bot.sendMessage(chatId, 'Calendar error: ' + e.message); }
      return;
    }

    if (text === '/week') {
      try {
        const events = await listEvents(7);
        if (typeof events === 'string') { await bot.sendMessage(chatId, events); return; }
        if (events.length === 0) { await bot.sendMessage(chatId, '📅 No events this week.'); return; }
        const lines = events.map(e => {
          const d = new Date(e.start);
          const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
          const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
          return `• *${day} ${time}* — ${e.summary}`;
        });
        await bot.sendMessage(chatId, `📅 *This Week*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
      } catch(e) { await bot.sendMessage(chatId, 'Calendar error: ' + e.message); }
      return;
    }

    if (text.startsWith('gcal auth ')) {
      try {
        const auth = getAuth();
        const { tokens } = await auth.getToken(text.slice(10).trim());
        auth.setCredentials(tokens);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
        await bot.sendMessage(chatId, '✅ Google Calendar authenticated and token saved.');
      } catch(e) { await bot.sendMessage(chatId, 'Auth error: ' + e.message); }
      return;
    }

    if (text === '/gcal-setup') {
      const auth = getAuth();
      if (!auth) { await bot.sendMessage(chatId, 'Place gmail-credentials.json first.'); return; }
      const url = auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
      await bot.sendMessage(chatId, `🔗 Authorize Calendar:\n${url}\n\nAfter authorizing, paste: gcal auth <code>`);
      return;
    }
  });

  console.log('✅ Google Calendar MCP active — /cal, /week, /gcal-setup');
}

module.exports = { setupGcal, listEvents, createEvent };
