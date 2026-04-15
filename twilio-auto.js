// twilio-auto.js — Full Twilio API automation for IBIS
// Natural language triggers: "configure twilio", "add a number", "check sms", etc.
// Handles: account management, number purchase/config, messaging services, A2P compliance,
// webhook setup, caller ID verification, usage monitoring — all without touching the console.
const axios = require('axios');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const ENV_PATH = path.join(__dirname, '.env.twilio');

// ── Credential management ───────────────────────────────────────

function loadCreds() {
  const creds = {
    sid: process.env.TWILIO_ACCOUNT_SID || '',
    token: process.env.TWILIO_AUTH_TOKEN || '',
    phone: process.env.TWILIO_PHONE || '+1XXXXXXXXXX',
  };
  // Also try .env.twilio file
  try {
    if (fs.existsSync(ENV_PATH)) {
      for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) {
          const key = line.slice(0, eq).trim();
          const val = line.slice(eq + 1).trim();
          if (key === 'TWILIO_ACCOUNT_SID' && val) creds.sid = val;
          if (key === 'TWILIO_AUTH_TOKEN' && val) creds.token = val;
          if (key === 'TWILIO_PHONE' && val) creds.phone = val;
        }
      }
    }
  } catch(e) {}
  return creds;
}

function saveCreds(sid, token, phone) {
  const content = `TWILIO_ACCOUNT_SID=${sid || ''}\nTWILIO_AUTH_TOKEN=${token || ''}\nTWILIO_PHONE=${phone || '+1XXXXXXXXXX'}\n`;
  fs.writeFileSync(ENV_PATH, content);
  if (sid) process.env.TWILIO_ACCOUNT_SID = sid;
  if (token) process.env.TWILIO_AUTH_TOKEN = token;
  if (phone) process.env.TWILIO_PHONE = phone;
}

function hasCreds() {
  const c = loadCreds();
  return !!(c.sid && c.token);
}

// ── Twilio API client ───────────────────────────────────────────

function api(method, endpoint, data) {
  const { sid, token } = loadCreds();
  if (!sid || !token) throw new Error('Twilio credentials not configured. Use: twilio setup <SID> <Token>');

  const isV1 = endpoint.startsWith('/v1/') || endpoint.startsWith('https://');
  const baseUrl = isV1
    ? (endpoint.startsWith('https://') ? '' : 'https://messaging.twilio.com')
    : `https://api.twilio.com/2010-04-01/Accounts/${sid}`;
  const url = endpoint.startsWith('https://') ? endpoint : `${baseUrl}${endpoint}${endpoint.includes('.json') ? '' : '.json'}`;

  const config = {
    method,
    url,
    auth: { username: sid, password: token },
    timeout: 20000,
  };

  if (data && method === 'GET') {
    config.params = data;
  } else if (data) {
    config.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    config.data = new URLSearchParams(data).toString();
  }

  return axios(config).then(r => r.data);
}

const get = (ep, params) => api('GET', ep, params);
const post = (ep, data) => api('POST', ep, data);
const put = (ep, data) => api('PUT', ep, data);
const del = (ep) => api('DELETE', ep);

// ── Account info ────────────────────────────────────────────────

async function getAccountInfo() {
  const acct = await get('');
  const bal = await get('/Balance');
  return {
    name: acct.friendly_name,
    status: acct.status,
    type: acct.type,
    created: acct.date_created,
    balance: `$${bal.balance} ${bal.currency}`,
  };
}

// ── Phone number operations ─────────────────────────────────────

async function listNumbers() {
  const data = await get('/IncomingPhoneNumbers', { PageSize: 50 });
  return (data.incoming_phone_numbers || []).map(p => ({
    sid: p.sid,
    phone: p.phone_number,
    friendly: p.friendly_name,
    smsUrl: p.sms_url,
    voiceUrl: p.voice_url,
    capabilities: p.capabilities,
  }));
}

async function searchNumbers(areaCode, country = 'US', type = 'local') {
  const endpoint = type === 'tollfree'
    ? `/AvailablePhoneNumbers/${country}/TollFree`
    : `/AvailablePhoneNumbers/${country}/Local`;
  const params = { SmsEnabled: true, PageSize: 10 };
  if (areaCode) params.AreaCode = areaCode;
  const data = await get(endpoint, params);
  return (data.available_phone_numbers || []).map(n => ({
    phone: n.phone_number,
    friendly: n.friendly_name,
    locality: n.locality,
    region: n.region,
    capabilities: n.capabilities,
  }));
}

async function buyNumber(phoneNumber) {
  const data = await post('/IncomingPhoneNumbers', { PhoneNumber: phoneNumber });
  return { sid: data.sid, phone: data.phone_number, friendly: data.friendly_name };
}

async function configureNumber(phoneSid, opts) {
  const params = {};
  if (opts.smsUrl) params.SmsUrl = opts.smsUrl;
  if (opts.smsMethod) params.SmsMethod = opts.smsMethod;
  if (opts.voiceUrl) params.VoiceUrl = opts.voiceUrl;
  if (opts.friendlyName) params.FriendlyName = opts.friendlyName;
  if (opts.statusCallback) params.StatusCallback = opts.statusCallback;
  const data = await post(`/IncomingPhoneNumbers/${phoneSid}`, params);
  return { sid: data.sid, phone: data.phone_number, smsUrl: data.sms_url };
}

async function releaseNumber(phoneSid) {
  await del(`/IncomingPhoneNumbers/${phoneSid}`);
  return true;
}

// ── Webhook auto-configure ──────────────────────────────────────

async function autoConfigureWebhooks() {
  const webhookUrl = `http://YOUR_VPS_IP:3200/sms`;
  const statusUrl = `http://YOUR_VPS_IP:3200/sms-status`;
  const numbers = await listNumbers();
  const results = [];

  for (const num of numbers) {
    if (num.smsUrl !== webhookUrl) {
      await configureNumber(num.sid, {
        smsUrl: webhookUrl,
        smsMethod: 'POST',
        statusCallback: statusUrl,
      });
      results.push(`${num.phone}: webhook set to IBIS`);
    } else {
      results.push(`${num.phone}: already configured`);
    }
  }
  return results;
}

// ── Verified caller IDs ─────────────────────────────────────────

async function listVerifiedCallers() {
  const data = await get('/OutgoingCallerIds', { PageSize: 50 });
  return (data.outgoing_caller_ids || []).map(c => ({
    sid: c.sid,
    phone: c.phone_number,
    friendly: c.friendly_name,
  }));
}

async function verifyCallerStart(phoneNumber, friendlyName) {
  const data = await post('/OutgoingCallerIds', {
    PhoneNumber: phoneNumber,
    FriendlyName: friendlyName || '',
  });
  return { sid: data.sid, validationCode: data.validation_code, phone: data.phone_number };
}

// ── Messaging services ──────────────────────────────────────────

async function listMessagingServices() {
  const data = await get('/v1/Services');
  return (data.services || []).map(s => ({
    sid: s.sid,
    name: s.friendly_name,
    usecase: s.usecase,
    statusCallback: s.status_callback,
  }));
}

async function createMessagingService(name, usecase) {
  const data = await post('/v1/Services', {
    FriendlyName: name,
    UseInboundWebhookOnNumber: 'true',
  });
  return { sid: data.sid, name: data.friendly_name };
}

async function addNumberToService(serviceSid, phoneSid) {
  const data = await post(`/v1/Services/${serviceSid}/PhoneNumbers`, { PhoneNumberSid: phoneSid });
  return { sid: data.sid, phone: data.phone_number };
}

// ── Usage & billing ─────────────────────────────────────────────

async function getUsage(category = 'sms', startDate, endDate) {
  const params = { Category: category };
  if (startDate) params.StartDate = startDate;
  if (endDate) params.EndDate = endDate;
  const data = await get('/Usage/Records', params);
  return (data.usage_records || []).map(r => ({
    category: r.category,
    count: r.count,
    price: r.price,
    unit: r.count_unit,
    period: `${r.start_date} to ${r.end_date}`,
  }));
}

async function getRecentMessages(limit = 20) {
  const data = await get('/Messages', { PageSize: limit });
  return (data.messages || []).map(m => ({
    sid: m.sid,
    from: m.from,
    to: m.to,
    body: (m.body || '').slice(0, 100),
    status: m.status,
    direction: m.direction,
    date: m.date_sent,
    price: m.price,
    errorCode: m.error_code,
    errorMsg: m.error_message,
  }));
}

// ── A2P / compliance ────────────────────────────────────────────

async function checkCompliance() {
  const results = { brands: [], campaigns: [], trustProducts: [] };

  try {
    const brands = await get('https://messaging.twilio.com/v1/a2p/BrandRegistrations');
    results.brands = (brands.brand_registrations || []).map(b => ({
      sid: b.sid,
      status: b.status,
      type: b.brand_type,
    }));
  } catch(e) { results.brands = [{ error: e.message }]; }

  try {
    const { sid } = loadCreds();
    const trust = await get(`https://trusthub.twilio.com/v1/CustomerProfiles`);
    results.trustProducts = (trust.results || []).map(t => ({
      sid: t.sid,
      name: t.friendly_name,
      status: t.status,
    }));
  } catch(e) { results.trustProducts = [{ error: e.message }]; }

  return results;
}

// ── Natural language intent matching ────────────────────────────

const INTENT_PATTERNS = [
  { patterns: [/configure\s+twilio/i, /setup\s+twilio/i, /twilio\s+setup/i, /twilio\s+configure/i], intent: 'configure' },
  { patterns: [/add\s+(?:a\s+)?(?:phone\s+)?number/i, /buy\s+(?:a\s+)?(?:phone\s+)?number/i, /get\s+(?:a\s+)?(?:new\s+)?number/i, /new\s+number/i], intent: 'buy_number' },
  { patterns: [/search\s+(?:for\s+)?number/i, /find\s+(?:a\s+)?number/i, /available\s+number/i], intent: 'search_numbers' },
  { patterns: [/check\s+sms/i, /sms\s+status/i, /check\s+message/i, /message\s+status/i, /check\s+twilio/i], intent: 'check_sms' },
  { patterns: [/twilio\s+status/i, /account\s+status/i, /twilio\s+info/i], intent: 'account_info' },
  { patterns: [/list\s+number/i, /my\s+number/i, /show\s+number/i, /phone\s+number/i], intent: 'list_numbers' },
  { patterns: [/verify\s+(?:a\s+)?(?:caller|number|phone)/i, /add\s+verified/i], intent: 'verify_caller' },
  { patterns: [/messaging\s+service/i, /create\s+service/i], intent: 'messaging_service' },
  { patterns: [/twilio\s+usage/i, /twilio\s+billing/i, /sms\s+cost/i, /how\s+much.*twilio/i], intent: 'usage' },
  { patterns: [/twilio\s+compliance/i, /a2p\s+status/i, /10dlc/i, /brand\s+registration/i], intent: 'compliance' },
  { patterns: [/configure\s+webhook/i, /setup\s+webhook/i, /set\s+webhook/i, /point.*webhook/i], intent: 'webhooks' },
  { patterns: [/release\s+number/i, /remove\s+number/i, /delete\s+number/i], intent: 'release_number' },
  { patterns: [/recent\s+(?:sms|message|text)/i, /message\s+log/i, /message\s+history/i], intent: 'recent_messages' },
];

function matchIntent(text) {
  for (const { patterns, intent } of INTENT_PATTERNS) {
    for (const p of patterns) {
      if (p.test(text)) return intent;
    }
  }
  return null;
}

// ── Telegram integration ────────────────────────────────────────

function setupTwilioAuto(bot, chatId, callModel, SYSTEM) {
  const db = new Database(path.join(__dirname, 'ibis_memory.db'));

  function credsCheck() {
    if (!hasCreds()) {
      return '❌ Twilio credentials not set.\n\nSet them with:\n`twilio setup <AccountSID> <AuthToken>`\n\nOr set them separately:\n`twilio sid <SID>`\n`twilio token <Token>`';
    }
    return null;
  }

  bot.on('message', async (msg) => {
    if (msg.chat.id !== chatId) return;
    const text = (msg.text || '').trim();
    if (!text) return;

    // ── Credential setup commands ─────────────────────────────

    // twilio setup <SID> <Token>
    if (text.startsWith('twilio setup ')) {
      const parts = text.slice(13).trim().split(/\s+/);
      if (parts.length < 2) {
        await bot.sendMessage(chatId, 'Usage: `twilio setup <AccountSID> <AuthToken>`', { parse_mode: 'Markdown' });
        return;
      }
      const [sid, token] = parts;
      const creds = loadCreds();
      saveCreds(sid, token, creds.phone);
      try { await bot.deleteMessage(chatId, msg.message_id); } catch(e) {}
      await bot.sendMessage(chatId, `✅ Twilio configured\nSID: \`...${sid.slice(-8)}\`\nToken: ✅ saved\nPhone: ${creds.phone}`, { parse_mode: 'Markdown' });
      return;
    }

    // ── Explicit commands ─────────────────────────────────────

    // twilio buy <phone_number>
    if (text.startsWith('twilio buy ')) {
      const err = credsCheck();
      if (err) { await bot.sendMessage(chatId, err, { parse_mode: 'Markdown' }); return; }
      const phoneNum = text.slice(11).trim();
      try {
        await bot.sendChatAction(chatId, 'typing');
        const result = await buyNumber(phoneNum);
        // Auto-configure webhooks on new number
        await configureNumber(result.sid, {
          smsUrl: 'http://YOUR_VPS_IP:3200/sms',
          smsMethod: 'POST',
          statusCallback: 'http://YOUR_VPS_IP:3200/sms-status',
          friendlyName: 'IBIS Line',
        });
        saveCreds(loadCreds().sid, loadCreds().token, phoneNum);
        await bot.sendMessage(chatId,
          `✅ *Number purchased and configured!*\n\n` +
          `Number: ${result.phone}\n` +
          `SID: \`${result.sid}\`\n` +
          `Webhook: pointed to IBIS\n` +
          `Status: ready to receive SMS`,
          { parse_mode: 'Markdown' }
        );
      } catch(e) {
        const errMsg = e.response?.data?.message || e.response?.data?.detail || e.message;
        await bot.sendMessage(chatId, `❌ Buy failed: ${errMsg}`);
      }
      return;
    }

    // twilio release <phone_sid>
    if (text.startsWith('twilio release ')) {
      const err = credsCheck();
      if (err) { await bot.sendMessage(chatId, err, { parse_mode: 'Markdown' }); return; }
      const phoneSid = text.slice(15).trim();
      try {
        await releaseNumber(phoneSid);
        await bot.sendMessage(chatId, `✅ Number ${phoneSid} released.`);
      } catch(e) {
        await bot.sendMessage(chatId, `❌ Release failed: ${e.response?.data?.message || e.message}`);
      }
      return;
    }

    // twilio verify <phone_number> [friendly_name]
    if (text.startsWith('twilio verify ')) {
      const err = credsCheck();
      if (err) { await bot.sendMessage(chatId, err, { parse_mode: 'Markdown' }); return; }
      const parts = text.slice(14).trim().split(/\s+/);
      const phone = parts[0];
      const name = parts.slice(1).join(' ') || '';
      try {
        await bot.sendChatAction(chatId, 'typing');
        const result = await verifyCallerStart(phone, name);
        await bot.sendMessage(chatId,
          `📞 *Verification started for ${phone}*\n\n` +
          `Twilio will call this number now.\n` +
          `When prompted, enter code: **${result.validationCode}**`,
          { parse_mode: 'Markdown' }
        );
      } catch(e) {
        await bot.sendMessage(chatId, `❌ Verify failed: ${e.response?.data?.message || e.message}`);
      }
      return;
    }

    // twilio search <area_code> [tollfree]
    if (text.startsWith('twilio search ')) {
      const err = credsCheck();
      if (err) { await bot.sendMessage(chatId, err, { parse_mode: 'Markdown' }); return; }
      const parts = text.slice(14).trim().split(/\s+/);
      const areaCode = parts[0];
      const type = parts[1] === 'tollfree' ? 'tollfree' : 'local';
      try {
        await bot.sendChatAction(chatId, 'typing');
        const nums = await searchNumbers(areaCode === 'tollfree' ? '' : areaCode, 'US', areaCode === 'tollfree' ? 'tollfree' : type);
        if (nums.length === 0) {
          await bot.sendMessage(chatId, `No ${type} numbers found for area code ${areaCode}.`);
          return;
        }
        const lines = nums.map(n => {
          const caps = [];
          if (n.capabilities?.sms) caps.push('SMS');
          if (n.capabilities?.voice) caps.push('Voice');
          if (n.capabilities?.mms) caps.push('MMS');
          return `\`${n.phone}\` — ${n.locality || ''} ${n.region || ''} [${caps.join(', ')}]`;
        });
        await bot.sendMessage(chatId,
          `📱 *Available Numbers*\n\n${lines.join('\n')}\n\n_Buy with:_ \`twilio buy +1XXXXXXXXXX\``,
          { parse_mode: 'Markdown' }
        );
      } catch(e) {
        await bot.sendMessage(chatId, `❌ Search failed: ${e.response?.data?.message || e.message}`);
      }
      return;
    }

    // twilio service create <name>
    if (text.startsWith('twilio service create ')) {
      const err = credsCheck();
      if (err) { await bot.sendMessage(chatId, err, { parse_mode: 'Markdown' }); return; }
      const name = text.slice(22).trim();
      try {
        const svc = await createMessagingService(name);
        // Auto-attach all numbers
        const numbers = await listNumbers();
        const attached = [];
        for (const num of numbers) {
          try {
            await addNumberToService(svc.sid, num.sid);
            attached.push(num.phone);
          } catch(e) {}
        }
        await bot.sendMessage(chatId,
          `✅ *Messaging Service Created*\n\nName: ${svc.name}\nSID: \`${svc.sid}\`\nAttached numbers: ${attached.join(', ') || 'none'}`,
          { parse_mode: 'Markdown' }
        );
      } catch(e) {
        await bot.sendMessage(chatId, `❌ ${e.response?.data?.message || e.message}`);
      }
      return;
    }

    // ── Natural language intent handling ───────────────────────

    const intent = matchIntent(text);
    if (!intent) return; // Not a Twilio-related message

    const err = credsCheck();
    if (err) { await bot.sendMessage(chatId, err, { parse_mode: 'Markdown' }); return; }

    await bot.sendChatAction(chatId, 'typing');

    try {
      switch (intent) {
        case 'configure': {
          // Full auto-configure: check account, list numbers, set webhooks
          const info = await getAccountInfo();
          const numbers = await listNumbers();
          const webhookResults = numbers.length > 0 ? await autoConfigureWebhooks() : [];
          const callers = await listVerifiedCallers();
          const services = await listMessagingServices();

          let report = `📱 *Twilio Configuration Report*\n\n`;
          report += `*Account:* ${info.name} (${info.type})\n`;
          report += `*Status:* ${info.status}\n`;
          report += `*Balance:* ${info.balance}\n\n`;

          report += `*Numbers (${numbers.length}):*\n`;
          for (const n of numbers) {
            const caps = [n.capabilities.sms && 'SMS', n.capabilities.voice && 'Voice', n.capabilities.mms && 'MMS'].filter(Boolean);
            report += `  ${n.phone} [${caps.join(', ')}] webhook: ${n.smsUrl || 'none'}\n`;
          }

          if (webhookResults.length > 0) {
            report += `\n*Webhook config:*\n`;
            for (const r of webhookResults) report += `  ${r}\n`;
          }

          report += `\n*Verified Callers (${callers.length}):*\n`;
          for (const c of callers) report += `  ${c.phone} — ${c.friendly}\n`;
          if (callers.length === 0) report += `  (none)\n`;

          report += `\n*Messaging Services (${services.length}):*\n`;
          for (const s of services) report += `  ${s.name} — ${s.sid}\n`;
          if (services.length === 0) report += `  (none — create one for A2P with \`twilio service create <name>\`)\n`;

          if (info.type === 'Trial') {
            report += `\n⚠️ *Trial account* — can only send to verified numbers. Upgrade at twilio.com/console/billing`;
          }

          await bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
          break;
        }

        case 'account_info': {
          const info = await getAccountInfo();
          await bot.sendMessage(chatId,
            `📱 *Twilio Account*\n\n` +
            `Name: ${info.name}\nStatus: ${info.status}\nType: ${info.type}\nBalance: ${info.balance}\nCreated: ${info.created}`,
            { parse_mode: 'Markdown' }
          );
          break;
        }

        case 'list_numbers': {
          const numbers = await listNumbers();
          if (numbers.length === 0) {
            await bot.sendMessage(chatId, '📱 No phone numbers on this account.\n\nSearch with: `twilio search 201` or `twilio search tollfree`', { parse_mode: 'Markdown' });
            break;
          }
          const lines = numbers.map(n => {
            const caps = [n.capabilities.sms && 'SMS', n.capabilities.voice && 'Voice'].filter(Boolean);
            return `• \`${n.phone}\` [${caps.join(', ')}] — ${n.friendly || 'no label'}\n  SID: \`${n.sid}\` | Webhook: ${n.smsUrl ? '✅' : '❌'}`;
          });
          await bot.sendMessage(chatId, `📱 *Your Numbers*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown' });
          break;
        }

        case 'search_numbers':
        case 'buy_number': {
          // Extract area code from message if present
          const codeMatch = text.match(/\b(\d{3})\b/);
          const isTollFree = /toll\s*free/i.test(text);
          const areaCode = isTollFree ? '' : (codeMatch ? codeMatch[1] : '201'); // Default NJ
          const type = isTollFree ? 'tollfree' : 'local';

          const nums = await searchNumbers(areaCode, 'US', type);
          if (nums.length === 0) {
            await bot.sendMessage(chatId, `No ${type} numbers found${areaCode ? ` for area code ${areaCode}` : ''}. Try a different area code.`);
            break;
          }
          const lines = nums.slice(0, 8).map(n => {
            const caps = [n.capabilities?.sms && 'SMS', n.capabilities?.voice && 'Voice', n.capabilities?.mms && 'MMS'].filter(Boolean);
            return `\`${n.phone}\` — ${n.locality || ''} ${n.region || ''} [${caps.join(', ')}]`;
          });
          await bot.sendMessage(chatId,
            `📱 *Available ${type} Numbers${areaCode ? ` (${areaCode})` : ''}*\n\n${lines.join('\n')}\n\n_Buy:_ \`twilio buy +1XXXXXXXXXX\``,
            { parse_mode: 'Markdown' }
          );
          break;
        }

        case 'check_sms':
        case 'recent_messages': {
          const msgs = await getRecentMessages(10);
          if (msgs.length === 0) {
            await bot.sendMessage(chatId, '📱 No messages found on this account.');
            break;
          }
          const lines = msgs.map(m => {
            const icon = m.direction === 'inbound' ? '📥' : '📤';
            const statusIcon = m.status === 'delivered' ? '✅' : m.status === 'failed' ? '❌' : m.status === 'sent' ? '📨' : '⏳';
            const errInfo = m.errorCode ? ` ⚠️${m.errorCode}` : '';
            return `${icon}${statusIcon} ${m.from} → ${m.to}\n  "${m.body}"${errInfo}`;
          });
          await bot.sendMessage(chatId, `📱 *Recent Messages*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown' });
          break;
        }

        case 'verify_caller': {
          const callers = await listVerifiedCallers();
          let report = `📞 *Verified Callers*\n\n`;
          if (callers.length === 0) {
            report += `None yet.\n\nVerify a number:\n\`twilio verify +1XXXXXXXXXX My Phone\``;
          } else {
            for (const c of callers) {
              report += `• ${c.phone} — ${c.friendly}\n`;
            }
            report += `\nAdd more: \`twilio verify +1XXXXXXXXXX Name\``;
          }
          await bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
          break;
        }

        case 'messaging_service': {
          const services = await listMessagingServices();
          if (services.length === 0) {
            await bot.sendMessage(chatId,
              `📱 No messaging services.\n\nCreate one:\n\`twilio service create IBIS Home Care\``,
              { parse_mode: 'Markdown' }
            );
          } else {
            const lines = services.map(s => `• *${s.name}*\n  SID: \`${s.sid}\`\n  Use: ${s.usecase || 'unset'}`);
            await bot.sendMessage(chatId, `📱 *Messaging Services*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown' });
          }
          break;
        }

        case 'usage': {
          const today = new Date();
          const startDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
          const smsUsage = await getUsage('sms', startDate);
          const callUsage = await getUsage('calls', startDate);
          const info = await getAccountInfo();

          let report = `💰 *Twilio Usage This Month*\n\n`;
          report += `Balance: ${info.balance}\n\n`;

          if (smsUsage.length > 0) {
            const total = smsUsage.reduce((s, r) => s + parseFloat(r.price || 0), 0);
            const count = smsUsage.reduce((s, r) => s + parseInt(r.count || 0), 0);
            report += `*SMS:* ${count} messages — $${total.toFixed(2)}\n`;
          } else {
            report += `*SMS:* no usage this month\n`;
          }

          if (callUsage.length > 0) {
            const total = callUsage.reduce((s, r) => s + parseFloat(r.price || 0), 0);
            const count = callUsage.reduce((s, r) => s + parseInt(r.count || 0), 0);
            report += `*Calls:* ${count} — $${total.toFixed(2)}\n`;
          } else {
            report += `*Calls:* no usage this month\n`;
          }

          await bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
          break;
        }

        case 'compliance': {
          const comp = await checkCompliance();
          let report = `🔒 *Twilio Compliance Status*\n\n`;

          report += `*A2P Brand Registrations:*\n`;
          if (comp.brands.length === 0 || comp.brands[0]?.error) {
            report += `  None / not accessible\n`;
            report += `  → Register at twilio.com/console/messaging/compliance\n`;
          } else {
            for (const b of comp.brands) report += `  ${b.sid}: ${b.status} (${b.type})\n`;
          }

          report += `\n*Trust Products:*\n`;
          if (comp.trustProducts.length === 0 || comp.trustProducts[0]?.error) {
            report += `  None configured\n`;
            report += `  → Set up at twilio.com/console/trust-center\n`;
          } else {
            for (const t of comp.trustProducts) report += `  ${t.name}: ${t.status}\n`;
          }

          await bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
          break;
        }

        case 'webhooks': {
          const results = await autoConfigureWebhooks();
          if (results.length === 0) {
            await bot.sendMessage(chatId, '📱 No numbers to configure. Buy a number first.');
          } else {
            await bot.sendMessage(chatId,
              `✅ *Webhooks Configured*\n\n${results.join('\n')}\n\nAll SMS now routed to IBIS.`,
              { parse_mode: 'Markdown' }
            );
          }
          break;
        }

        case 'release_number': {
          const numbers = await listNumbers();
          if (numbers.length === 0) {
            await bot.sendMessage(chatId, 'No numbers to release.');
          } else {
            const lines = numbers.map(n => `• ${n.phone} — SID: \`${n.sid}\``);
            await bot.sendMessage(chatId,
              `📱 *Which number to release?*\n\n${lines.join('\n')}\n\n_Release with:_ \`twilio release <SID>\``,
              { parse_mode: 'Markdown' }
            );
          }
          break;
        }
      }
    } catch(e) {
      const errMsg = e.response?.data?.message || e.response?.data?.detail || e.message;
      const code = e.response?.status || '';
      await bot.sendMessage(chatId, `❌ Twilio API error${code ? ` (${code})` : ''}: ${errMsg}`);
    }
  });

  console.log('✅ Twilio Auto active — natural language: "configure twilio", "add a number", "check sms", etc.');
}

module.exports = { setupTwilioAuto, searchNumbers, buyNumber, listNumbers, getAccountInfo };
