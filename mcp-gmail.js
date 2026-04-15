// mcp-gmail.js — Gmail MCP integration for IBIS
// Connects to Gmail via Google APIs to read/send email
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, 'gmail-credentials.json');
const TOKEN_PATH = path.join(__dirname, 'gmail-token.json');
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];

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

async function listEmails(maxResults = 10, query = 'is:unread') {
  const auth = getAuth();
  if (!auth) return 'Gmail not configured. Place gmail-credentials.json in openclaw/.';
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.messages.list({ userId: 'me', maxResults, q: query });
  const messages = res.data.messages || [];
  const summaries = [];
  for (const msg of messages.slice(0, maxResults)) {
    const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
    const headers = full.data.payload.headers;
    const from = headers.find(h => h.name === 'From')?.value || '';
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    const date = headers.find(h => h.name === 'Date')?.value || '';
    summaries.push({ id: msg.id, from, subject, date, snippet: full.data.snippet });
  }
  return summaries;
}

async function getEmailBody(messageId) {
  const auth = getAuth();
  if (!auth) return 'Gmail not configured.';
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const parts = res.data.payload.parts || [res.data.payload];
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf8');
    }
  }
  return res.data.snippet || 'No body found.';
}

async function sendEmail(to, subject, body) {
  const auth = getAuth();
  if (!auth) return 'Gmail not configured.';
  const gmail = google.gmail({ version: 'v1', auth });
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
  ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return 'Sent.';
}

function getAuthUrl() {
  const auth = getAuth();
  if (!auth) return 'Place gmail-credentials.json first.';
  return auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
}

async function handleAuthCode(code) {
  const auth = getAuth();
  const { tokens } = await auth.getToken(code);
  auth.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  return 'Gmail authenticated and token saved.';
}

function setupGmail(bot, chatId, callModel, SYSTEM) {
  bot.on('message', async (msg) => {
    if (msg.chat.id !== chatId) return;
    const text = (msg.text || '').trim();

    if (text === '/email' || text === '/mail') {
      try {
        const emails = await listEmails(5);
        if (typeof emails === 'string') { await bot.sendMessage(chatId, emails); return; }
        const lines = emails.map((e, i) => `${i + 1}. *${e.subject}*\nFrom: ${e.from}\n${e.snippet}`);
        await bot.sendMessage(chatId, `📧 *Unread Emails*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown' });
      } catch(e) { await bot.sendMessage(chatId, 'Gmail error: ' + e.message); }
      return;
    }

    if (text.startsWith('gmail auth ')) {
      try {
        const result = await handleAuthCode(text.slice(11).trim());
        await bot.sendMessage(chatId, result);
      } catch(e) { await bot.sendMessage(chatId, 'Auth error: ' + e.message); }
      return;
    }

    if (text === '/gmail-setup') {
      const url = getAuthUrl();
      await bot.sendMessage(chatId, `🔗 Authorize Gmail:\n${url}\n\nAfter authorizing, paste the code with: gmail auth <code>`);
      return;
    }
  });

  console.log('✅ Gmail MCP active — /email, /mail, /gmail-setup');
}

module.exports = { setupGmail, listEmails, getEmailBody, sendEmail, getAuthUrl, handleAuthCode };
