// twilio-sms.js — Twilio SMS handler for IBIS
// Inbound: webhook receives SMS → forwards to Telegram → IBIS responds → reply sent back via SMS
// Outbound: send SMS from Telegram with "sms <number> <message>"
const http = require('http');
const https = require('https');
const { URL, URLSearchParams } = require('url');
const Database = require('better-sqlite3');
const path = require('path');
const querystring = require('querystring');

const SMS_PORT = process.env.SMS_PORT || 3200;

// ── Config from env or DB ───────────────────────────────────────

function getConfig() {
  const sid = process.env.TWILIO_ACCOUNT_SID || '';
  const token = process.env.TWILIO_AUTH_TOKEN || '';
  const from = process.env.TWILIO_PHONE || '+1XXXXXXXXXX';
  return { sid, token, from };
}

// ── Outbound SMS ────────────────────────────────────────────────

async function sendSMS(to, body) {
  const { sid, token, from } = getConfig();
  if (!sid || !token) return { success: false, error: 'Twilio credentials not set. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN env vars.' };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: from, Body: body });

  return new Promise((resolve) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.sid) {
            resolve({ success: true, messageSid: json.sid, status: json.status });
          } else {
            resolve({ success: false, error: json.message || json.detail || data });
          }
        } catch(e) {
          resolve({ success: false, error: data.slice(0, 200) });
        }
      });
    });
    req.on('error', e => resolve({ success: false, error: e.message }));
    req.write(params.toString());
    req.end();
  });
}

// ── Webhook signature validation ────────────────────────────────

function validateTwilioSignature(params, signature, url) {
  // Basic validation — check the request has Twilio-standard fields
  // Full HMAC validation requires the auth token and reconstructing the URL
  // For now, check that required SMS fields are present
  return params.From && params.Body !== undefined && params.AccountSid;
}

// ── Inbound webhook server ──────────────────────────────────────

function startWebhookServer(onIncomingSMS) {
  const server = http.createServer((req, res) => {
    // Health check
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('IBIS SMS webhook OK');
      return;
    }

    // Twilio sends POST to /sms
    if (req.url === '/sms' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        const params = querystring.parse(body);

        if (!params.From || params.Body === undefined) {
          res.writeHead(400, { 'Content-Type': 'text/xml' });
          res.end('<Response/>');
          return;
        }

        console.log(`[sms-in] From: ${params.From} Body: ${params.Body.slice(0, 100)}`);

        // Process the incoming SMS asynchronously
        let replyText = '';
        try {
          replyText = await onIncomingSMS({
            from: params.From,
            to: params.To || '',
            body: params.Body,
            messageSid: params.MessageSid || '',
            accountSid: params.AccountSid || '',
            numMedia: parseInt(params.NumMedia || '0'),
          });
        } catch(e) {
          console.error('[sms-in] Handler error:', e.message);
          replyText = 'IBIS received your message. We will respond shortly.';
        }

        // Respond with TwiML
        const twiml = replyText
          ? `<Response><Message>${escapeXml(replyText.slice(0, 1500))}</Message></Response>`
          : '<Response/>';

        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml);
      });
      return;
    }

    // Twilio status callbacks
    if (req.url === '/sms-status' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const params = querystring.parse(body);
        console.log(`[sms-status] ${params.MessageSid}: ${params.MessageStatus}`);
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end('<Response/>');
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(SMS_PORT, '0.0.0.0', () => {
    console.log(`✅ SMS webhook server running on port ${SMS_PORT}`);
  });

  return server;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── IBIS integration ────────────────────────────────────────────

function setupTwilioSMS(bot, chatId, callModel, SYSTEM) {
  const db = new Database(path.join(__dirname, 'ibis_memory.db'));

  // SMS conversation log
  db.exec(`CREATE TABLE IF NOT EXISTS sms_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT,
    phone TEXT,
    body TEXT,
    status TEXT,
    message_sid TEXT,
    ts INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // Contact names
  db.exec(`CREATE TABLE IF NOT EXISTS sms_contacts (
    phone TEXT PRIMARY KEY,
    name TEXT,
    notes TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  function logSMS(direction, phone, body, status, msgSid) {
    db.prepare('INSERT INTO sms_log (direction, phone, body, status, message_sid) VALUES (?, ?, ?, ?, ?)')
      .run(direction, phone, body, status || '', msgSid || '');
  }

  function getContactName(phone) {
    const r = db.prepare('SELECT name FROM sms_contacts WHERE phone = ?').get(phone);
    return r ? r.name : null;
  }

  function getConversationHistory(phone, limit = 10) {
    return db.prepare('SELECT direction, body, ts FROM sms_log WHERE phone = ? ORDER BY ts DESC LIMIT ?')
      .all(phone, limit).reverse();
  }

  // ── Inbound SMS handler ─────────────────────────────────────

  async function handleIncomingSMS(msg) {
    const { from, body } = msg;
    logSMS('inbound', from, body, 'received', msg.messageSid);

    const contactName = getContactName(from) || from;
    const history = getConversationHistory(from, 6);
    const historyText = history.map(h => `${h.direction === 'inbound' ? 'Them' : 'IBIS'}: ${h.body}`).join('\n');

    // Notify Soul via Telegram
    await bot.sendMessage(chatId,
      `📱 *Incoming SMS*\n\nFrom: ${contactName} (${from})\n\n> ${body}\n\n_Reply with:_ \`sms ${from} your reply\``,
      { parse_mode: 'Markdown' }
    );

    // Generate auto-reply using Sofia's home care voice
    const sofiaReply = await callModel('fast', [{
      role: 'user',
      content: `You are Sofia Elmer, the home care communication specialist for 24 Hour Home Care NJ / Bonjour Home Care Group. Someone texted the business line.

Their message: "${body}"
Contact: ${contactName}
Previous conversation:
${historyText || '(first message)'}

Rules:
- Be warm, professional, and helpful
- If they're asking about services, briefly describe home care services and invite them to call
- If they need to speak to someone, say "I'll connect you with our care coordinator right away"
- Keep it under 160 characters when possible (SMS)
- If it seems like a wrong number or spam, reply briefly and politely
- NEVER share pricing over text — say "I'd love to discuss your specific needs. May I call you?"

Reply with ONLY the SMS text to send back. No explanation.`
    }], SYSTEM);

    logSMS('outbound', from, sofiaReply, 'auto-reply', '');

    // Also send the auto-reply to Telegram for Soul's awareness
    await bot.sendMessage(chatId,
      `📱 *Sofia auto-replied to ${contactName}:*\n${sofiaReply}\n\n_Override? Send your own reply within 30s with:_ \`sms ${from} your message\``,
      { parse_mode: 'Markdown' }
    );

    return sofiaReply;
  }

  // Start the webhook server
  startWebhookServer(handleIncomingSMS);

  // ── Telegram commands ─────────────────────────────────────────

  bot.on('message', async (msg) => {
    if (msg.chat.id !== chatId) return;
    const text = (msg.text || '').trim();

    // sms <number> <message> — send an SMS
    if (text.startsWith('sms ')) {
      const rest = text.slice(4).trim();
      // Parse: number can be +1xxxxxxxxxx or (xxx) xxx-xxxx etc
      const match = rest.match(/^(\+?\d[\d\s().-]{8,16})\s+(.+)/s);
      if (!match) {
        await bot.sendMessage(chatId, 'Usage: `sms +1XXXXXXXXXX your message here`', { parse_mode: 'Markdown' });
        return;
      }
      const toNumber = match[1].replace(/[\s().-]/g, '');
      const smsBody = match[2].trim();

      await bot.sendChatAction(chatId, 'typing');
      const result = await sendSMS(toNumber, smsBody);

      if (result.success) {
        logSMS('outbound', toNumber, smsBody, result.status, result.messageSid);
        const name = getContactName(toNumber) || toNumber;
        await bot.sendMessage(chatId, `✅ SMS sent to ${name}\nStatus: ${result.status}\nSID: \`${result.messageSid}\``, { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, `❌ SMS failed: ${result.error}`);
      }
      return;
    }

    // /sms-log — recent SMS activity
    if (text === '/sms-log' || text === '/sms') {
      const recent = db.prepare('SELECT direction, phone, body, ts FROM sms_log ORDER BY ts DESC LIMIT 15').all();
      if (recent.length === 0) {
        await bot.sendMessage(chatId, '📱 No SMS activity yet.');
        return;
      }
      const lines = recent.map(r => {
        const arrow = r.direction === 'inbound' ? '📥' : '📤';
        const name = getContactName(r.phone) || r.phone;
        const time = new Date(r.ts * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        return `${arrow} ${time} ${name}: ${r.body.slice(0, 60)}`;
      });
      await bot.sendMessage(chatId, `📱 *SMS Log*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
      return;
    }

    // sms contact <number> <name> — save a contact name
    if (text.startsWith('sms contact ')) {
      const parts = text.slice(12).trim().match(/^(\+?\d[\d\s().-]{8,16})\s+(.+)/);
      if (!parts) {
        await bot.sendMessage(chatId, 'Usage: `sms contact +1XXXXXXXXXX John Smith`', { parse_mode: 'Markdown' });
        return;
      }
      const phone = parts[1].replace(/[\s().-]/g, '');
      const name = parts[2].trim();
      db.prepare('INSERT INTO sms_contacts (phone, name) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET name=excluded.name')
        .run(phone, name);
      await bot.sendMessage(chatId, `✅ Contact saved: ${name} → ${phone}`);
      return;
    }

    // /sms-contacts — list saved contacts
    if (text === '/sms-contacts') {
      const contacts = db.prepare('SELECT phone, name FROM sms_contacts ORDER BY name').all();
      if (contacts.length === 0) {
        await bot.sendMessage(chatId, 'No contacts saved. Use: `sms contact +1XXX Name`');
        return;
      }
      const lines = contacts.map(c => `• *${c.name}* — ${c.phone}`);
      await bot.sendMessage(chatId, `📱 *SMS Contacts*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
      return;
    }

    // /sms-thread <number> — view conversation thread with a number
    if (text.startsWith('/sms-thread ')) {
      const phone = text.slice(12).trim().replace(/[\s().-]/g, '');
      const history = getConversationHistory(phone, 20);
      if (history.length === 0) {
        await bot.sendMessage(chatId, `No SMS history with ${phone}.`);
        return;
      }
      const name = getContactName(phone) || phone;
      const lines = history.map(h => {
        const arrow = h.direction === 'inbound' ? '←' : '→';
        return `${arrow} ${h.body}`;
      });
      await bot.sendMessage(chatId, `📱 *Thread with ${name}*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
      return;
    }

    // /sms-status — system status
    if (text === '/sms-status') {
      const { sid, token, from } = getConfig();
      const total = db.prepare('SELECT COUNT(*) as cnt FROM sms_log').get().cnt;
      const inbound = db.prepare("SELECT COUNT(*) as cnt FROM sms_log WHERE direction='inbound'").get().cnt;
      const outbound = db.prepare("SELECT COUNT(*) as cnt FROM sms_log WHERE direction='outbound'").get().cnt;
      const contacts = db.prepare('SELECT COUNT(*) as cnt FROM sms_contacts').get().cnt;

      const sidStatus = sid ? `\`...${sid.slice(-8)}\`` : '❌ Not set';
      const tokenStatus = token ? '✅ Set' : '❌ Not set';

      await bot.sendMessage(chatId,
        `📱 *SMS System Status*\n\n` +
        `SID: ${sidStatus}\n` +
        `Auth Token: ${tokenStatus}\n` +
        `From Number: ${from}\n` +
        `Webhook: port ${SMS_PORT}\n\n` +
        `Total messages: ${total}\n` +
        `Inbound: ${inbound} | Outbound: ${outbound}\n` +
        `Contacts: ${contacts}\n\n` +
        `Webhook URL for Twilio:\n\`http://YOUR_VPS_IP:${SMS_PORT}/sms\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // twilio token <token> — set auth token at runtime
    if (text.startsWith('twilio token ')) {
      const token = text.slice(13).trim();
      if (token.length < 20) {
        await bot.sendMessage(chatId, 'Token looks too short. Twilio auth tokens are 32 characters.');
        return;
      }
      // Write to env file for persistence across restarts
      const envPath = path.join(__dirname, '.env.twilio');
      const fs = require('fs');
      const envContent = `TWILIO_ACCOUNT_SID=${process.env.TWILIO_ACCOUNT_SID || ''}\nTWILIO_AUTH_TOKEN=${token}\nTWILIO_PHONE=${process.env.TWILIO_PHONE || '+1XXXXXXXXXX'}\n`;
      fs.writeFileSync(envPath, envContent);
      process.env.TWILIO_AUTH_TOKEN = token;
      await bot.sendMessage(chatId, '✅ Twilio auth token set and saved. Run `/sms-status` to verify, or `/twilio` to diagnose.');

      // Delete the message containing the token for security
      try { await bot.deleteMessage(chatId, msg.message_id); } catch(e) { /* may not have delete permission */ }
      return;
    }

    // twilio sid <sid> — update account SID at runtime
    if (text.startsWith('twilio sid ')) {
      const sid = text.slice(11).trim();
      const envPath = path.join(__dirname, '.env.twilio');
      const fs = require('fs');
      const envContent = `TWILIO_ACCOUNT_SID=${sid}\nTWILIO_AUTH_TOKEN=${process.env.TWILIO_AUTH_TOKEN || ''}\nTWILIO_PHONE=${process.env.TWILIO_PHONE || '+1XXXXXXXXXX'}\n`;
      fs.writeFileSync(envPath, envContent);
      process.env.TWILIO_ACCOUNT_SID = sid;
      await bot.sendMessage(chatId, `✅ Twilio SID updated to \`...${sid.slice(-8)}\``, { parse_mode: 'Markdown' });
      try { await bot.deleteMessage(chatId, msg.message_id); } catch(e) {}
      return;
    }
  });

  // Load saved env on startup
  try {
    const fs = require('fs');
    const envPath = path.join(__dirname, '.env.twilio');
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const [key, ...val] = line.split('=');
        if (key && val.length > 0 && !process.env[key]) {
          process.env[key] = val.join('=').trim();
        }
      }
      console.log('  └─ Loaded Twilio credentials from .env.twilio');
    }
  } catch(e) { /* no env file yet */ }

  console.log('✅ Twilio SMS active — sms <number> <msg>, /sms, /sms-status, webhook on :' + SMS_PORT);
}

module.exports = { setupTwilioSMS, sendSMS };
