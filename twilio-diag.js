// twilio-diag.js — Twilio account diagnostic tool for IBIS
// Checks account status, verification, phone numbers, messaging capabilities, and blockers.
const axios = require('axios');
const Database = require('better-sqlite3');
const path = require('path');

// ── Twilio REST helpers ─────────────────────────────────────────

function twilioGet(sid, token, endpoint) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}${endpoint}.json`;
  return axios.get(url, { auth: { username: sid, password: token }, timeout: 15000 });
}

function twilioList(sid, token, endpoint, params) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}${endpoint}.json`;
  return axios.get(url, { auth: { username: sid, password: token }, params, timeout: 15000 });
}

// ── Diagnostic checks ───────────────────────────────────────────

async function diagnoseAccount(sid, token, label) {
  const report = {
    label: label || sid.slice(-6),
    sid,
    checks: [],
    blockers: [],
    status: 'unknown',
  };

  function check(name, status, detail) {
    report.checks.push({ name, status, detail });
    if (status === 'FAIL' || status === 'BLOCKED') report.blockers.push(`${name}: ${detail}`);
  }

  // 1. Account status
  try {
    const { data: acct } = await twilioGet(sid, token, '');
    report.status = acct.status;
    report.friendlyName = acct.friendly_name;
    report.type = acct.type;
    report.dateCreated = acct.date_created;

    if (acct.status === 'active') {
      check('Account Status', 'OK', `Active — ${acct.friendly_name}`);
    } else if (acct.status === 'suspended') {
      check('Account Status', 'BLOCKED', `Suspended — contact Twilio support to reactivate`);
    } else {
      check('Account Status', 'FAIL', `Status: ${acct.status}`);
    }

    // Check if trial
    if (acct.type === 'Trial') {
      check('Account Type', 'WARN', 'Trial account — limited to verified numbers only. Upgrade to remove restrictions.');
    } else {
      check('Account Type', 'OK', acct.type);
    }
  } catch(e) {
    if (e.response?.status === 401) {
      check('Authentication', 'BLOCKED', 'Invalid SID/Token — credentials rejected (401)');
      return report;
    } else if (e.response?.status === 404) {
      check('Authentication', 'BLOCKED', 'Account not found (404) — SID may be wrong');
      return report;
    }
    check('Authentication', 'FAIL', e.message);
    return report;
  }

  // 2. Balance check
  try {
    const { data: balance } = await twilioGet(sid, token, '/Balance');
    const bal = parseFloat(balance.balance);
    if (bal <= 0) {
      check('Balance', 'BLOCKED', `$${balance.balance} ${balance.currency} — no funds, add credit`);
    } else if (bal < 1) {
      check('Balance', 'WARN', `$${balance.balance} ${balance.currency} — low balance`);
    } else {
      check('Balance', 'OK', `$${balance.balance} ${balance.currency}`);
    }
  } catch(e) {
    check('Balance', 'FAIL', `Could not fetch: ${e.response?.data?.message || e.message}`);
  }

  // 3. Phone numbers
  try {
    const { data: numbers } = await twilioList(sid, token, '/IncomingPhoneNumbers', { PageSize: 20 });
    const phones = numbers.incoming_phone_numbers || [];
    if (phones.length === 0) {
      check('Phone Numbers', 'WARN', 'No phone numbers — buy one at twilio.com/console/phone-numbers');
    } else {
      for (const p of phones) {
        const caps = [];
        if (p.capabilities.voice) caps.push('voice');
        if (p.capabilities.sms) caps.push('SMS');
        if (p.capabilities.mms) caps.push('MMS');
        check(`Number ${p.phone_number}`, 'OK', `${caps.join(', ')} — ${p.friendly_name || 'no label'}`);
      }
    }
  } catch(e) {
    check('Phone Numbers', 'FAIL', e.response?.data?.message || e.message);
  }

  // 4. Verified caller IDs (critical for trial accounts)
  try {
    const { data: verified } = await twilioList(sid, token, '/OutgoingCallerIds', { PageSize: 20 });
    const callerIds = verified.outgoing_caller_ids || [];
    if (callerIds.length === 0) {
      check('Verified Callers', 'WARN', 'No verified caller IDs — trial accounts can only call/SMS verified numbers');
    } else {
      const nums = callerIds.map(c => c.phone_number).join(', ');
      check('Verified Callers', 'OK', `${callerIds.length} verified: ${nums}`);
    }
  } catch(e) {
    check('Verified Callers', 'FAIL', e.response?.data?.message || e.message);
  }

  // 5. Messaging services
  try {
    const url = `https://messaging.twilio.com/v1/Services`;
    const { data: services } = await axios.get(url, { auth: { username: sid, password: token }, timeout: 15000 });
    const svcList = services.services || [];
    if (svcList.length === 0) {
      check('Messaging Services', 'INFO', 'No messaging services configured — optional but recommended for A2P');
    } else {
      for (const s of svcList) {
        check(`Messaging Svc: ${s.friendly_name}`, 'OK', `SID: ${s.sid}, usecase: ${s.usecase || 'unset'}`);
      }
    }
  } catch(e) {
    check('Messaging Services', 'INFO', 'Could not query messaging services');
  }

  // 6. A2P 10DLC brand registration (US SMS compliance)
  try {
    const url = `https://messaging.twilio.com/v1/a2p/BrandRegistrations`;
    const { data: brands } = await axios.get(url, { auth: { username: sid, password: token }, timeout: 15000 });
    const brandList = brands.brand_registrations || [];
    if (brandList.length === 0) {
      check('A2P 10DLC Brand', 'WARN', 'No brand registered — required for US SMS. Register at twilio.com/console/messaging/compliance');
    } else {
      for (const b of brandList) {
        const bStatus = b.status || 'unknown';
        if (bStatus === 'APPROVED') {
          check(`Brand: ${b.a2p_profile_bundle_sid || b.sid}`, 'OK', `Approved`);
        } else {
          check(`Brand: ${b.sid}`, 'WARN', `Status: ${bStatus} — may need action`);
        }
      }
    }
  } catch(e) {
    check('A2P 10DLC', 'INFO', 'Could not query A2P status');
  }

  // 7. Campaign registration
  try {
    const url = `https://messaging.twilio.com/v1/a2p/BrandRegistrations`;
    const { data: brands } = await axios.get(url, { auth: { username: sid, password: token }, timeout: 15000 });
    const brandList = brands.brand_registrations || [];
    if (brandList.length > 0) {
      for (const b of brandList) {
        try {
          const campUrl = `https://messaging.twilio.com/v1/a2p/BrandRegistrations/${b.sid}/SmsUsecases`;
          const { data: usecases } = await axios.get(campUrl, { auth: { username: sid, password: token }, timeout: 15000 });
          if (usecases.sms_usecases?.length > 0) {
            check('SMS Campaign', 'OK', `${usecases.sms_usecases.length} use case(s) registered`);
          } else {
            check('SMS Campaign', 'WARN', 'Brand exists but no campaigns — register a use case');
          }
        } catch(e) { /* skip */ }
      }
    }
  } catch(e) { /* skip */ }

  // 8. Recent errors in message logs
  try {
    const { data: msgs } = await twilioList(sid, token, '/Messages', { PageSize: 10, 'Status': 'failed' });
    const failed = (msgs.messages || []).filter(m => m.status === 'failed' || m.status === 'undelivered');
    if (failed.length > 0) {
      const errors = failed.slice(0, 3).map(m => `${m.error_code}: ${m.error_message || 'unknown'}`);
      check('Recent Failures', 'WARN', `${failed.length} failed messages. Errors: ${errors.join('; ')}`);
    } else {
      check('Recent Failures', 'OK', 'No recent failures');
    }
  } catch(e) {
    check('Message Logs', 'INFO', 'Could not query message logs');
  }

  return report;
}

// ── Report formatter ────────────────────────────────────────────

function formatReport(report) {
  const icon = { OK: '✅', WARN: '⚠️', FAIL: '❌', BLOCKED: '🚫', INFO: 'ℹ️' };
  const lines = [];

  lines.push(`📱 *Account: ${report.label}*`);
  lines.push(`SID: \`...${report.sid.slice(-8)}\``);
  if (report.friendlyName) lines.push(`Name: ${report.friendlyName}`);
  if (report.type) lines.push(`Type: ${report.type}`);
  lines.push(`Status: ${report.status}`);
  lines.push('');

  for (const c of report.checks) {
    lines.push(`${icon[c.status] || '❓'} *${c.name}*: ${c.detail}`);
  }

  if (report.blockers.length > 0) {
    lines.push('');
    lines.push('🚧 *Blockers:*');
    for (const b of report.blockers) {
      lines.push(`  → ${b}`);
    }
  } else {
    lines.push('');
    lines.push('✅ *No critical blockers found.*');
  }

  return lines.join('\n');
}

// ── Fix suggestions ─────────────────────────────────────────────

async function suggestFixes(reports, callModel, SYSTEM) {
  const summary = reports.map(r => {
    const checks = r.checks.map(c => `[${c.status}] ${c.name}: ${c.detail}`).join('\n');
    return `Account ${r.label} (${r.status}, ${r.type}):\n${checks}\nBlockers: ${r.blockers.join('; ') || 'none'}`;
  }).join('\n\n---\n\n');

  return await callModel('reasoning', [{
    role: 'user',
    content: `You are a Twilio account specialist. Analyze these diagnostic reports and provide a concrete fix plan.

For each account, explain:
1. What's wrong (the specific blocker)
2. Exact steps to fix it (with Twilio console URLs where possible)
3. What order to do things in
4. Whether the account is salvageable or if starting fresh is better

If any account is a trial that was never upgraded, explain the upgrade process.
If any account needs A2P 10DLC registration, give the step-by-step.
Be specific and actionable — Soul needs to execute this today.

Diagnostic Reports:
${summary.slice(0, 3500)}`
  }], SYSTEM);
}

// ── Telegram integration ────────────────────────────────────────

function setupTwilioDiag(bot, chatId, callModel, SYSTEM) {
  const db = new Database(path.join(__dirname, 'ibis_memory.db'));

  // Store Twilio accounts
  db.exec(`CREATE TABLE IF NOT EXISTS twilio_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT,
    sid TEXT UNIQUE,
    token TEXT,
    added_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  bot.on('message', async (msg) => {
    if (msg.chat.id !== chatId) return;
    const text = (msg.text || '').trim();

    // Add an account: twilio add <label> <SID> <token>
    if (text.startsWith('twilio add ')) {
      const parts = text.slice(11).trim().split(/\s+/);
      if (parts.length < 3) {
        await bot.sendMessage(chatId, 'Usage: `twilio add <label> <AccountSID> <AuthToken>`', { parse_mode: 'Markdown' });
        return;
      }
      const [label, sid, token] = parts;
      if (!sid.startsWith('AC') || sid.length !== 34) {
        await bot.sendMessage(chatId, 'Invalid Account SID — should start with AC and be 34 characters.');
        return;
      }
      db.prepare('INSERT INTO twilio_accounts (label, sid, token) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET label=excluded.label, token=excluded.token')
        .run(label, sid, token);
      await bot.sendMessage(chatId, `✅ Twilio account *${label}* saved. Run /twilio to diagnose.`, { parse_mode: 'Markdown' });
      return;
    }

    // Remove an account
    if (text.startsWith('twilio remove ')) {
      const label = text.slice(14).trim();
      db.prepare('DELETE FROM twilio_accounts WHERE label = ? OR sid LIKE ?').run(label, '%' + label);
      await bot.sendMessage(chatId, `Removed Twilio account: ${label}`);
      return;
    }

    // List saved accounts
    if (text === '/twilio-accounts' || text === 'twilio list') {
      const accounts = db.prepare('SELECT label, sid FROM twilio_accounts ORDER BY added_at').all();
      if (accounts.length === 0) {
        await bot.sendMessage(chatId, 'No Twilio accounts saved. Add one:\n`twilio add <label> <SID> <Token>`', { parse_mode: 'Markdown' });
        return;
      }
      const lines = accounts.map(a => `• *${a.label}* — \`...${a.sid.slice(-8)}\``);
      await bot.sendMessage(chatId, `📱 *Saved Twilio Accounts*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
      return;
    }

    // Diagnose all accounts: /twilio
    if (text === '/twilio' || text === 'twilio diagnose') {
      const accounts = db.prepare('SELECT label, sid, token FROM twilio_accounts ORDER BY added_at').all();
      if (accounts.length === 0) {
        await bot.sendMessage(chatId, 'No accounts saved. Add first:\n`twilio add <label> <SID> <Token>`', { parse_mode: 'Markdown' });
        return;
      }

      await bot.sendMessage(chatId, `🔍 *Diagnosing ${accounts.length} Twilio account(s)...*`, { parse_mode: 'Markdown' });

      const reports = [];
      for (const acct of accounts) {
        await bot.sendChatAction(chatId, 'typing');
        const report = await diagnoseAccount(acct.sid, acct.token, acct.label);
        reports.push(report);
        const formatted = formatReport(report);
        // Send each report individually (can be long)
        try {
          await bot.sendMessage(chatId, formatted, { parse_mode: 'Markdown' });
        } catch(e) {
          // Markdown parse fail — send as plain text
          await bot.sendMessage(chatId, formatted.replace(/[*`]/g, ''));
        }
      }

      // Generate AI fix plan
      await bot.sendChatAction(chatId, 'typing');
      const fixPlan = await suggestFixes(reports, callModel, SYSTEM);
      try {
        await bot.sendMessage(chatId, `🔧 *IBIS Fix Plan*\n\n${fixPlan}`, { parse_mode: 'Markdown' });
      } catch(e) {
        await bot.sendMessage(chatId, `🔧 IBIS Fix Plan\n\n${fixPlan}`);
      }
      return;
    }

    // Diagnose a single account by label
    if (text.startsWith('twilio check ')) {
      const label = text.slice(13).trim();
      const acct = db.prepare('SELECT label, sid, token FROM twilio_accounts WHERE label = ?').get(label);
      if (!acct) {
        await bot.sendMessage(chatId, `Account "${label}" not found. Run \`twilio list\` to see saved accounts.`);
        return;
      }

      await bot.sendChatAction(chatId, 'typing');
      const report = await diagnoseAccount(acct.sid, acct.token, acct.label);
      const formatted = formatReport(report);
      try {
        await bot.sendMessage(chatId, formatted, { parse_mode: 'Markdown' });
      } catch(e) {
        await bot.sendMessage(chatId, formatted.replace(/[*`]/g, ''));
      }

      await bot.sendChatAction(chatId, 'typing');
      const fixPlan = await suggestFixes([report], callModel, SYSTEM);
      try {
        await bot.sendMessage(chatId, `🔧 *Fix Plan for ${label}*\n\n${fixPlan}`, { parse_mode: 'Markdown' });
      } catch(e) {
        await bot.sendMessage(chatId, `🔧 Fix Plan for ${label}\n\n${fixPlan}`);
      }
      return;
    }

    // Quick one-shot diagnose without saving: twilio diag <SID> <Token>
    if (text.startsWith('twilio diag ')) {
      const parts = text.slice(12).trim().split(/\s+/);
      if (parts.length < 2) {
        await bot.sendMessage(chatId, 'Usage: `twilio diag <AccountSID> <AuthToken>`', { parse_mode: 'Markdown' });
        return;
      }
      const [sid, token] = parts;
      await bot.sendChatAction(chatId, 'typing');
      const report = await diagnoseAccount(sid, token, 'one-shot');
      const formatted = formatReport(report);
      try {
        await bot.sendMessage(chatId, formatted, { parse_mode: 'Markdown' });
      } catch(e) {
        await bot.sendMessage(chatId, formatted.replace(/[*`]/g, ''));
      }
      return;
    }
  });

  console.log('✅ Twilio Diagnostics active — twilio add, /twilio, twilio check <label>');
}

module.exports = { setupTwilioDiag, diagnoseAccount, formatReport, suggestFixes };
