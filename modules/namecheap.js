// modules/namecheap.js — Playwright-driven Namecheap domain management for IBIS
// Screenshots every action → sends to Telegram
// /confirm required before any DNS change
// All actions logged to SQLite browser_actions table
const { chromium } = require('playwright');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');

function setupNamecheap(bot, chatId, callModel, SYSTEM) {
  const db = new Database(path.join(__dirname, '..', 'ibis_memory.db'));

  // Create tables
  db.exec(`CREATE TABLE IF NOT EXISTS browser_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module TEXT,
    action TEXT,
    target TEXT,
    detail TEXT,
    screenshot TEXT,
    status TEXT DEFAULT 'ok',
    ts INTEGER DEFAULT (strftime('%s','now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS namecheap_creds (
    id INTEGER PRIMARY KEY,
    username TEXT,
    password TEXT
  )`);

  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // Pending confirmation state
  let pendingAction = null;

  function logAction(action, target, detail, screenshotPath, status) {
    db.prepare('INSERT INTO browser_actions (module, action, target, detail, screenshot, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run('namecheap', action, target || '', detail || '', screenshotPath || '', status || 'ok');
  }

  function getCreds() {
    const row = db.prepare('SELECT username, password FROM namecheap_creds WHERE id=1').get();
    return row || null;
  }

  async function takeScreenshot(page, label) {
    const filename = `nc_${label}_${Date.now()}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: false });
    return filepath;
  }

  async function sendScreenshot(filepath, caption) {
    try {
      await bot.sendPhoto(chatId, filepath, { caption: caption || '' });
    } catch(e) {
      await bot.sendMessage(chatId, `[Screenshot failed: ${e.message}]`);
    }
  }

  // ── Core Playwright actions ─────────────────────────────────

  async function ncLogin() {
    const creds = getCreds();
    if (!creds) throw new Error('No Namecheap credentials. Use: nc login <username> <password>');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    try {
      await page.goto('https://www.namecheap.com/myaccount/login/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      let shot = await takeScreenshot(page, 'login_page');
      await sendScreenshot(shot, '📸 Namecheap login page loaded');
      logAction('navigate', 'login', 'Login page loaded', shot);

      // Fill credentials
      await page.fill('input[name="LoginUserName"], #ctl00_ctl00_ctl00_ctl00_base_content_web_base_content_home_content_page_content_left_ctl02_LoginPanel_txtUserName', creds.username);
      await page.fill('input[name="LoginPassword"], #ctl00_ctl00_ctl00_ctl00_base_content_web_base_content_home_content_page_content_left_ctl02_LoginPanel_txtPassword', creds.password);

      shot = await takeScreenshot(page, 'login_filled');
      logAction('fill', 'login', 'Credentials entered', shot);

      // Submit
      await page.click('input[type="submit"], button[type="submit"], .nc_btn_submit');
      await page.waitForTimeout(5000);

      shot = await takeScreenshot(page, 'login_result');
      await sendScreenshot(shot, '📸 Login attempt result');

      // Check for 2FA or dashboard
      const url = page.url();
      const content = await page.content();

      if (content.includes('Two-Factor') || content.includes('verification') || content.includes('Security Code')) {
        logAction('login', 'namecheap', '2FA required', shot, 'pending_2fa');
        return { browser, context, page, status: '2fa_required' };
      }

      if (url.includes('dashboard') || url.includes('myaccount') || content.includes('Domain List')) {
        logAction('login', 'namecheap', 'Login successful', shot);
        return { browser, context, page, status: 'logged_in' };
      }

      logAction('login', 'namecheap', `Post-login URL: ${url}`, shot, 'unknown');
      return { browser, context, page, status: 'unknown' };
    } catch(e) {
      const shot = await takeScreenshot(page, 'login_error');
      await sendScreenshot(shot, `📸 Login error: ${e.message}`);
      logAction('login', 'namecheap', e.message, shot, 'error');
      await browser.close();
      throw e;
    }
  }

  async function ncListDomains() {
    const session = await ncLogin();
    const { browser, page } = session;

    try {
      await page.goto('https://ap.www.namecheap.com/domains/list/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      let shot = await takeScreenshot(page, 'domain_list');
      await sendScreenshot(shot, '📸 Domain list page');
      logAction('list_domains', 'namecheap', 'Domain list loaded', shot);

      // Extract domain data from the page
      const domains = await page.evaluate(() => {
        const rows = [];
        // Try multiple selector patterns Namecheap uses
        document.querySelectorAll('[class*="domain-name"], .domain-row, tr[class*="domain"], [data-domain]').forEach(el => {
          const text = el.textContent.trim().replace(/\s+/g, ' ');
          if (text.length > 3 && text.length < 200) rows.push(text);
        });
        // Fallback: grab visible text that looks like domains
        if (rows.length === 0) {
          const bodyText = document.body.innerText;
          const domainPattern = /[\w-]+\.(?:com|net|org|io|ai|co|xyz|dev|app)\b/gi;
          const matches = bodyText.match(domainPattern);
          if (matches) rows.push(...[...new Set(matches)]);
        }
        return rows.slice(0, 50);
      });

      logAction('list_domains', 'namecheap', `Found ${domains.length} domains`, shot);
      return { domains, screenshot: shot };
    } finally {
      await browser.close();
    }
  }

  async function ncGetNameservers(domain) {
    const session = await ncLogin();
    const { browser, page } = session;

    try {
      // Navigate to domain management
      await page.goto(`https://ap.www.namecheap.com/domains/domaincontrolpanel/${domain}/domain`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      let shot = await takeScreenshot(page, `ns_${domain}`);
      await sendScreenshot(shot, `📸 Nameservers for ${domain}`);

      // Try to extract nameserver info
      const nsInfo = await page.evaluate(() => {
        const text = document.body.innerText;
        const nsPattern = /ns\d*\.[\w.-]+/gi;
        const matches = text.match(nsPattern);
        return {
          nameservers: matches ? [...new Set(matches)] : [],
          pageText: text.slice(0, 2000),
        };
      });

      logAction('get_nameservers', domain, JSON.stringify(nsInfo.nameservers), shot);
      return { domain, nameservers: nsInfo.nameservers, screenshot: shot };
    } finally {
      await browser.close();
    }
  }

  async function ncSetNameservers(domain, nameservers) {
    // This is a DNS change — requires /confirm
    const session = await ncLogin();
    const { browser, page } = session;

    try {
      await page.goto(`https://ap.www.namecheap.com/domains/domaincontrolpanel/${domain}/domain`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      let shot = await takeScreenshot(page, `ns_change_${domain}_before`);
      await sendScreenshot(shot, `📸 Before nameserver change — ${domain}`);
      logAction('set_nameservers_before', domain, `Target NS: ${nameservers.join(', ')}`, shot);

      // Look for Custom DNS option
      const customDnsSelector = 'text=Custom DNS, [data-testid*="custom"], label:has-text("Custom DNS")';
      try {
        await page.click(customDnsSelector, { timeout: 5000 });
        await page.waitForTimeout(1000);
      } catch(e) {
        // May already be on custom DNS
      }

      // Fill nameserver fields
      const nsInputs = await page.$$('input[name*="nameserver"], input[placeholder*="Nameserver"], input[class*="nameserver"]');
      for (let i = 0; i < Math.min(nameservers.length, nsInputs.length); i++) {
        await nsInputs[i].fill('');
        await nsInputs[i].fill(nameservers[i]);
      }

      shot = await takeScreenshot(page, `ns_change_${domain}_filled`);
      await sendScreenshot(shot, `📸 Nameservers filled — ${domain}\n${nameservers.join('\n')}`);
      logAction('set_nameservers_filled', domain, nameservers.join(', '), shot);

      // Click save/apply
      try {
        await page.click('button:has-text("Save"), button:has-text("Apply"), [class*="save"]', { timeout: 5000 });
        await page.waitForTimeout(3000);
      } catch(e) {
        logAction('set_nameservers', domain, 'Save button not found: ' + e.message, shot, 'error');
        return { success: false, error: 'Could not find save button' };
      }

      shot = await takeScreenshot(page, `ns_change_${domain}_after`);
      await sendScreenshot(shot, `📸 After nameserver change — ${domain}`);
      logAction('set_nameservers_done', domain, nameservers.join(', '), shot);

      return { success: true, domain, nameservers };
    } finally {
      await browser.close();
    }
  }

  // ── Telegram command handler ──────────────────────────────────

  bot.on('message', async (msg) => {
    if (msg.chat.id !== chatId) return;
    const text = (msg.text || '').trim();

    // nc login <username> <password> — store credentials
    if (text.startsWith('nc login ')) {
      const parts = text.slice(9).trim().split(/\s+/);
      if (parts.length < 2) {
        await bot.sendMessage(chatId, 'Usage: `nc login <username> <password>`', { parse_mode: 'Markdown' });
        return;
      }
      const [username, password] = [parts[0], parts.slice(1).join(' ')];
      db.prepare('INSERT OR REPLACE INTO namecheap_creds (id, username, password) VALUES (1, ?, ?)').run(username, password);
      try { await bot.deleteMessage(chatId, msg.message_id); } catch(e) {}
      await bot.sendMessage(chatId, `✅ Namecheap credentials saved for *${username}*`, { parse_mode: 'Markdown' });
      logAction('save_creds', username, 'Credentials stored', '', 'ok');
      return;
    }

    // /domains — list all domains
    if (text === '/domains' || text === 'list domains') {
      await bot.sendMessage(chatId, '🌐 Fetching domain list from Namecheap...');
      await bot.sendChatAction(chatId, 'typing');
      try {
        const result = await ncListDomains();
        if (result.domains.length === 0) {
          await bot.sendMessage(chatId, '🌐 No domains found or could not parse domain list.');
        } else {
          const lines = result.domains.map((d, i) => `${i + 1}. ${d}`);
          await bot.sendMessage(chatId, `🌐 *Namecheap Domains*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
        }
      } catch(e) {
        await bot.sendMessage(chatId, `❌ Domain list failed: ${e.message}`);
      }
      return;
    }

    // nc ns <domain> — show nameservers for a domain
    if (text.startsWith('nc ns ')) {
      const domain = text.slice(6).trim();
      await bot.sendMessage(chatId, `🌐 Fetching nameservers for ${domain}...`);
      await bot.sendChatAction(chatId, 'typing');
      try {
        const result = await ncGetNameservers(domain);
        const nsList = result.nameservers.length > 0
          ? result.nameservers.map(ns => `• \`${ns}\``).join('\n')
          : '(could not extract nameservers — check screenshot)';
        await bot.sendMessage(chatId, `🌐 *Nameservers for ${domain}*\n\n${nsList}`, { parse_mode: 'Markdown' });
      } catch(e) {
        await bot.sendMessage(chatId, `❌ NS lookup failed: ${e.message}`);
      }
      return;
    }

    // nc set-ns <domain> <ns1> <ns2> [...] — queue nameserver change (requires /confirm)
    if (text.startsWith('nc set-ns ')) {
      const parts = text.slice(10).trim().split(/\s+/);
      if (parts.length < 3) {
        await bot.sendMessage(chatId, 'Usage: `nc set-ns example.com ns1.provider.com ns2.provider.com`', { parse_mode: 'Markdown' });
        return;
      }
      const domain = parts[0];
      const nameservers = parts.slice(1);

      // Store pending — require /confirm
      pendingAction = { type: 'set_nameservers', domain, nameservers, ts: Date.now() };
      logAction('set_ns_queued', domain, nameservers.join(', '), '', 'pending');

      await bot.sendMessage(chatId,
        `⚠️ *DNS CHANGE QUEUED*\n\n` +
        `Domain: \`${domain}\`\n` +
        `New nameservers:\n${nameservers.map(ns => `  • \`${ns}\``).join('\n')}\n\n` +
        `This will change DNS resolution for this domain.\n` +
        `Type \`/confirm\` to execute or \`/cancel\` to abort.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // /confirm — execute pending DNS action
    if (text === '/confirm') {
      if (!pendingAction) {
        await bot.sendMessage(chatId, 'No pending action to confirm.');
        return;
      }

      // Expire after 5 minutes
      if (Date.now() - pendingAction.ts > 5 * 60 * 1000) {
        pendingAction = null;
        await bot.sendMessage(chatId, '⏰ Pending action expired (5 min timeout). Re-issue the command.');
        return;
      }

      const action = pendingAction;
      pendingAction = null;

      if (action.type === 'set_nameservers') {
        await bot.sendMessage(chatId, `🌐 Executing nameserver change for ${action.domain}...`);
        await bot.sendChatAction(chatId, 'typing');
        try {
          const result = await ncSetNameservers(action.domain, action.nameservers);
          if (result.success) {
            await bot.sendMessage(chatId, `✅ Nameservers updated for *${action.domain}*\n\n${action.nameservers.join('\n')}`, { parse_mode: 'Markdown' });
          } else {
            await bot.sendMessage(chatId, `❌ Update may have failed: ${result.error}`);
          }
        } catch(e) {
          await bot.sendMessage(chatId, `❌ Nameserver change failed: ${e.message}`);
        }
      }
      return;
    }

    // /cancel — cancel pending action
    if (text === '/cancel') {
      if (pendingAction) {
        logAction('cancelled', pendingAction.domain || '', JSON.stringify(pendingAction), '', 'cancelled');
        pendingAction = null;
        await bot.sendMessage(chatId, '✅ Pending action cancelled.');
      } else {
        await bot.sendMessage(chatId, 'Nothing to cancel.');
      }
      return;
    }

    // /nc-log — show recent browser actions
    if (text === '/nc-log') {
      const actions = db.prepare("SELECT action, target, detail, status, ts FROM browser_actions WHERE module='namecheap' ORDER BY ts DESC LIMIT 15").all();
      if (actions.length === 0) {
        await bot.sendMessage(chatId, '🌐 No Namecheap actions logged yet.');
        return;
      }
      const lines = actions.map(a => {
        const time = new Date(a.ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const icon = a.status === 'ok' ? '✅' : a.status === 'error' ? '❌' : a.status === 'pending' ? '⏳' : '📋';
        return `${icon} ${time} — ${a.action} ${a.target ? '→ ' + a.target : ''}\n   ${(a.detail || '').slice(0, 80)}`;
      });
      await bot.sendMessage(chatId, `🌐 *Namecheap Action Log*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown' });
      return;
    }
  });

  console.log('✅ Namecheap module active — /domains, nc ns <domain>, nc set-ns, /nc-log');
}

module.exports = { setupNamecheap };
