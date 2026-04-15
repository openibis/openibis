const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const LOCK = '/tmp/ibis.lock';

// Kill any existing ibis.js node processes (except this one)
try {
  const pids = execSync("pgrep -f 'node.*ibis\\.js'", { encoding: 'utf8' }).trim().split('\n');
  for (const pid of pids) {
    const p = parseInt(pid);
    if (p && p !== process.pid) { try { process.kill(p, 'SIGTERM'); } catch(e) {} }
  }
} catch(e) { /* no matching processes */ }

// Check lockfile — if PID is still alive, exit immediately
if (fs.existsSync(LOCK)) {
  try {
    const pid = parseInt(fs.readFileSync(LOCK, 'utf8'));
    if (pid && pid !== process.pid) {
      process.kill(pid, 0); // throws if process doesn't exist
      console.error('IBIS already running (PID ' + pid + '). Exiting.');
      process.exit(1);
    }
  } catch(e) {
    // Process not running — stale lockfile, remove it
    try { fs.unlinkSync(LOCK); } catch(e2) {}
  }
}

// Create lockfile
fs.writeFileSync(LOCK, String(process.pid));
function cleanLock() { try { fs.unlinkSync(LOCK); } catch(e) {} }
process.on('exit', cleanLock);
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', (err) => { console.error('Uncaught:', err); cleanLock(); process.exit(1); });
const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const Groq = require('groq-sdk');
const Database = require('better-sqlite3');
const axios = require('axios');
const cheerio = require('cheerio');
// Load secrets from .env file
(function loadEnv() {
  try {
    const envFile = require('fs').readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of envFile.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0 && !line.startsWith('#')) {
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        if (val && !process.env[key]) process.env[key] = val;
      }
    }
  } catch(e) { /* .env not found, use process.env */ }
})();
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const GROQ_KEY = process.env.GROQ_KEY;
const ALLOWED_ID = parseInt(process.env.ALLOWED_CHAT_ID);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const claude = new Anthropic({ apiKey: ANTHROPIC_KEY });
const groq = new Groq({ apiKey: GROQ_KEY });
const db = new Database(path.join(__dirname, 'ibis_memory.db'));
db.exec('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, role TEXT, content TEXT, ts DATETIME DEFAULT CURRENT_TIMESTAMP)');
db.exec('CREATE TABLE IF NOT EXISTS knowledge (id INTEGER PRIMARY KEY, key TEXT UNIQUE, value TEXT, ts DATETIME DEFAULT CURRENT_TIMESTAMP)');
function saveMsg(role, content) { db.prepare('INSERT INTO messages (role,content) VALUES (?,?)').run(role, content); }
function getHistory() { return db.prepare('SELECT role,content FROM messages ORDER BY ts DESC LIMIT 30').all().reverse().map(r => ({ role: r.role, content: r.content })); }
function memWrite(k, v) { db.prepare('INSERT INTO knowledge (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v); return 'Saved: ' + k; }
function memRead(k) { const r = db.prepare('SELECT value FROM knowledge WHERE key=?').get(k); return r ? r.value : 'Not found.'; }
function memSearch(q) { const rows = db.prepare('SELECT key,value FROM knowledge WHERE key LIKE ? OR value LIKE ? LIMIT 6').all('%'+q+'%','%'+q+'%'); return rows.map(r => '['+r.key+']: '+r.value).join(', '); }
async function webSearch(q) { try { const r = await axios.get('https://html.duckduckgo.com/html/?q='+encodeURIComponent(q),{headers:{'User-Agent':'Mozilla/5.0'},timeout:8000}); const $ = cheerio.load(r.data); const res=[]; $('.result__snippet').each((i,el)=>{ if(i<5) res.push($(el).text().trim()); }); return res.join(' | ')||'No results.'; } catch(e) { return 'Search error: '+e.message; } }
function classify(t) { if (/plan|architect|strategy|how should/i.test(t)) return 'strategic'; if (t.length>600||/summarize|full report/i.test(t)) return 'long'; if (t.length<180||/quick|status|what is|check/i.test(t)) return 'fast'; return 'daily'; }
async function callModel(route, messages, system) {
  const { callOpenRouter } = require('./router.js');
  const task = route === 'strategic' ? 'reasoning' : route === 'long' ? 'long' : 'fast';
  return await callOpenRouter(messages, task, system);
}
const today = new Date().toDateString();
const SYSTEM = "Today is " + new Date().toDateString() + ". You are IBIS - Soul's governing AI agent. Soul is YOUR_NAME. Businesses: 24 Hour Home Care NJ, Bonjour Home Care Group, ExNTER.com. Sub-agents: Henry, Marcus, Vera, Sofia, Lane, Felix, Aria. Search when asked. Be direct, proactive, precise. Never share YOUR-PHONE-NUMBER. Core principles (Karpathy 4): 1) Always be knolling — keep everything organized, file immediately. 2) Always be learning — extract patterns, store insights, improve. 3) Always be building — bias toward action, ship small, iterate fast. 4) Always be compressing — reduce complexity, consolidate, simplify.";

function memoryRemember(k,v){db.prepare('INSERT INTO knowledge(key,value,created_at)VALUES(?,?,?)ON CONFLICT(key)DO UPDATE SET value=excluded.value,created_at=excluded.created_at').run(k.trim().toLowerCase(),v.trim(),Date.now());return 'Stored: '+k+' = '+v;}
function memoryRecall(k){const r=db.prepare('SELECT value FROM knowledge WHERE key=?').get(k.trim().toLowerCase());return r?k+' = '+r.value:'Not found: '+k;}
function memoryList(){const rows=db.prepare('SELECT key,value FROM knowledge ORDER BY created_at DESC LIMIT 20').all();return rows.length?rows.map(r=>r.key+': '+r.value).join('\n'):'Memory empty.';}
const SHORTCUTS=async(msg,text)=>{const id=msg.chat.id;if(text==="/status"){await bot.sendMessage(id,"IBIS online. Memory active. Queue running. All systems operational.");return true;}if(text==="/agents"){await bot.sendMessage(id,"Agents under Zorian:\n• Henry Ivis — Operations\n• Sofia Elmer — Home Care Voice\n• Vera Wayne — Compliance\n• Lane — Finance\n• Felix — Recruiting\n• Marcus — Marketing");return true;}if(text==="/memory"){const rows=db.prepare("SELECT key,value FROM knowledge ORDER BY created_at DESC LIMIT 20").all();const out=rows.length?rows.map(r=>"• "+r.key+": "+r.value).join("\n"):"Memory empty.";await bot.sendMessage(id,out);return true;}return false;};
async function reactLoop(chatId,userMsg){
let thoughts=[];
let iterations=0;
const MAX=5;
thoughts.push({role:"user",content:userMsg});
while(iterations<MAX){
iterations++;
const sys="You are IBIS. Think step by step. If you need to search the web write ACTION: search(<query>). If you have a final answer write FINAL: <answer>";
const res=await callModel("default",thoughts,sys);
thoughts.push({role:"assistant",content:res});
if(res.includes("FINAL:")){
const answer=res.split("FINAL:")[1].trim();
await bot.sendMessage(chatId,answer);
return;
}
if(res.includes("ACTION: search(")){
const q=res.split("ACTION: search(")[1].split(")")[0];
await bot.sendMessage(chatId,"Searching: "+q);
const results=await webSearch(q);
thoughts.push({role:"user",content:"OBSERVATION: "+results});
}
}
await bot.sendMessage(chatId,"Task complete.");
}

const { setupInbox } = require('./inbox.js');
setupInbox(bot, ALLOWED_ID, callModel, SYSTEM);

// Semantic memory search via ChromaDB
function semanticSearch(query) {
  const { execSync } = require('child_process');
  try {
    const result = execSync('python3 ' + __dirname + '/memory_palace.py search ' + JSON.stringify(query)).toString().trim();
    return result.includes('No memories') ? '' : result;
  } catch(e) { return ''; }
}

function semanticStore(key, text, tags) {
  const { execSync } = require('child_process');
  try {
    execSync('python3 ' + __dirname + '/memory_palace.py store ' + JSON.stringify(key) + ' ' + JSON.stringify(text) + ' ' + JSON.stringify(tags || 'general'));
  } catch(e) {}
}

const { setupQueue } = require('./queue.js');
setupQueue(bot);
const { setupSweep, runDailySweep } = require('./sweep.js');
const { runReleaseMonitor } = require('./skills/release-monitor.js');
setupSweep(bot, ALLOWED_ID, callModel, SYSTEM);
const { setupEvolution, runEvolution } = require('./evolve.js');
setupEvolution(bot, ALLOWED_ID, callModel, SYSTEM);
// Proactive scheduler
const { setupProactive } = require('./proactive.js');
setupProactive(bot, ALLOWED_ID, callModel, SYSTEM, ANTHROPIC_KEY);
// Henry daily web scraper (FireCrawl)
const { setupHenryScraper } = require('./henry-scraper.js');
setupHenryScraper(bot, ALLOWED_ID, callModel, SYSTEM);
// Gmail MCP
const { setupGmail } = require('./mcp-gmail.js');
setupGmail(bot, ALLOWED_ID, callModel, SYSTEM);
// Google Calendar MCP
const { setupGcal } = require('./mcp-gcal.js');
setupGcal(bot, ALLOWED_ID, callModel, SYSTEM);
// Next-task skill
const { setupNextTask } = require('./next-task.js');
setupNextTask(bot, ALLOWED_ID, callModel, SYSTEM);
// KAIROS — background task detection
const { setupKairos } = require('./kairos.js');
setupKairos(bot, ALLOWED_ID, callModel, SYSTEM);
// AutoDream — smart memory consolidation (replaces basic 3am evolution)
const { setupAutoDream } = require('./autodream.js');
setupAutoDream(bot, ALLOWED_ID, callModel, SYSTEM);
// MCP Agent Registry
const { setupMcpAgents } = require('./mcp-agents.js');
setupMcpAgents(bot, ALLOWED_ID);
// Aria — NLP/Hypnosis knowledge agent
const { setupAria } = require('./aria.js');
setupAria(bot, ALLOWED_ID, callModel, SYSTEM);
// Aria Ingest Pipeline — master file ingestion with PII stripping
const { setupAriaIngest } = require('./aria-ingest.js');
setupAriaIngest(bot, ALLOWED_ID, callModel, SYSTEM);
// Twilio Diagnostics
const { setupTwilioDiag } = require('./twilio-diag.js');
setupTwilioDiag(bot, ALLOWED_ID, callModel, SYSTEM);
// Twilio SMS handler
const { setupTwilioSMS } = require('./twilio-sms.js');
setupTwilioSMS(bot, ALLOWED_ID, callModel, SYSTEM);
// Twilio full API automation (natural language)
const { setupTwilioAuto } = require('./twilio-auto.js');
setupTwilioAuto(bot, ALLOWED_ID, callModel, SYSTEM);
// MemPalace browser
const { setupPalace } = require('./modules/palace.js');
setupPalace(bot, ALLOWED_ID);
// Namecheap domain management (Playwright)
const { setupNamecheap } = require('./modules/namecheap.js');
setupNamecheap(bot, ALLOWED_ID, callModel, SYSTEM);
// News Mini App
const { setupNewsMiniApp } = require('./news-miniapp.js');
setupNewsMiniApp(bot, ALLOWED_ID);
bot.on('message', async (msg) => {
  if (msg.chat.id !== ALLOWED_ID) return;
  const text = (msg.text||'').trim();
  if (!text) return;
  saveMsg('user', text);
  if (text.toLowerCase() === 'evolve now' || text.toLowerCase() === '/evolve') {
    await runEvolution(bot, msg.chat.id, callModel, SYSTEM);
    return;
  }
  if (text.toLowerCase() === 'sweep now' || text.toLowerCase() === '/sweep') {
    await runDailySweep(bot, msg.chat.id, callModel, SYSTEM);
    return;
  }
  
  await bot.sendChatAction(msg.chat.id, 'typing');
  try {
    const route = classify(text);
    const history = getHistory();
    const semantic = semanticSearch(text);
    const mem = memSearch(text.split(' ').slice(0,4).join(' '));
    const sys = (mem || semantic) ? SYSTEM + (semantic ? " SemanticMemory: " + semantic.slice(0,500) : "") +' Memory: '+mem : SYSTEM;
    const triggers = ['find','search','look up','research','what is','who is','latest','news','check'];
    if(text.startsWith('pdf ')){await bot.sendMessage(msg.chat.id,await ingestPDF(text.slice(4).trim()));return;}
  if(text.startsWith('youtube ')){await bot.sendMessage(msg.chat.id,await ingestYouTube(text.slice(8)));return;}
if(text.startsWith('ingest ')){await bot.sendMessage(msg.chat.id,await ingestURL(text.slice(7)));return;}
if(text.startsWith('visit ')){await bot.sendMessage(msg.chat.id,await browserVisit(text.slice(6)));return;}
  if(text.startsWith("think ")){ await reactLoop(msg.chat.id,text.slice(6)); return; }
  if (triggers.some(t => text.toLowerCase().includes(t))) { const res = await webSearch(text); history.push({role:'user',content:'Web results: '+res}); }
    const reply = await callModel(route, history, sys);
    saveMsg('assistant', reply);
    if (reply.length>4000) { const chunks=reply.match(/.{1,4000}/gs)||[reply]; for(const c of chunks) await bot.sendMessage(msg.chat.id,c); }
    else await bot.sendMessage(msg.chat.id, reply);
  } catch(e) { console.error(e.message); try { await bot.sendMessage(msg.chat.id,'Error: '+e.message); } catch(_){} }
});
const OUTBOX=path.join(__dirname, 'outbox.json');
function loadQ(){try{return JSON.parse(fs.readFileSync(OUTBOX,"utf8"));}catch(e){return[];}}
function saveQ(q){fs.writeFileSync(OUTBOX,JSON.stringify(q,null,2));}
function queueMsg(chatId,text){const q=loadQ();q.push({chatId,text,ts:Date.now(),attempts:0});saveQ(q);}
async function flushQ(){const q=loadQ();if(q.length===0)return;const failed=[];for(const item of q){try{await bot.sendMessage(item.chatId,item.text);}catch(e){item.attempts=(item.attempts||0)+1;if(item.attempts<10)failed.push(item);}}saveQ(failed);}
setInterval(flushQ,2*60*1000);
async function browserVisit(url){const {chromium}=require("playwright");let browser;try{browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto(url,{waitUntil:"domcontentloaded",timeout:20000});const title=await page.title();const text=await page.evaluate(()=>document.body.innerText);return "["+title+"]\n"+text.slice(0,3000);}catch(e){return "Browser error: "+e.message;}finally{if(browser)await browser.close();}}
async function ingestURL(url,room){
const content=await browserVisit(url);
const key="ingest::"+url.slice(0,50);
db.prepare("INSERT INTO knowledge(key,value,created_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key,content,Date.now());
return "Ingested and stored in palace: "+url;
}
async function ingestPDF(path){
  try{
    const {execSync}=require('child_process');
    const result=execSync('python3 ' + __dirname + '/pdf_get.py '+path).toString().trim();
    const key='pdf::'+path.split('/').pop();
    db.prepare('INSERT INTO knowledge(key,value,created_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,result,Date.now());
    return 'PDF ingested: '+key;
  }catch(e){return 'PDF error: '+e.message;}
}
async function ingestYouTube(url){
  try{
    let videoId=null;
    if(url.indexOf('v=')>=0){videoId=url.split('v=')[1].split('&')[0];}
    else if(url.indexOf('youtu.be/')>=0){videoId=url.split('youtu.be/')[1].split('?')[0];}
    if(!videoId)return 'Invalid YouTube URL';
    const {execSync}=require('child_process');
    const result=execSync('python3 ' + __dirname + '/yt_get.py '+videoId).toString().trim();
    const key='youtube::'+videoId;
    db.prepare('INSERT INTO knowledge(key,value,created_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,result,Date.now());
    return 'YouTube transcript ingested: '+url;
  }catch(e){return 'YouTube error: '+e.message;}
}

