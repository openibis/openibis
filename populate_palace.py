#!/usr/bin/env python3
"""Populate all MemPalace rooms in ibis_memory.db"""
import sqlite3, os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ibis_memory.db")
db = sqlite3.connect(DB_PATH)

rooms = {}

# ── ROOM 1: Architect's Room ──────────────────────────────────────

rooms["architect::system_overview"] = """IBIS SYSTEM ARCHITECTURE
IBIS is Soul (YOUR_NAME) governing AI agent. Node.js, Hetzner VPS YOUR_VPS_IP, pm2 managed.
CORE: ibis.js (Telegram bot, routing, memory, search)
ROUTER: router.js (OpenRouter: GPT-4o-mini fast, Gemini Flash long, Claude Sonnet reasoning, Claude Opus premium)
MEMORY: SQLite ibis_memory.db + ChromaDB memory_palace.py
SCHEDULING: proactive.js (7:30am releases, 9am briefing+empire, 2pm alerts, Sunday summaries)"""

rooms["architect::module_map"] = """IBIS MODULE MAP
AGENTS: Henry(henry-scraper.js) Ops 7am | Sofia(aria-ingest.js) Home Care Voice SMS | Marcus Marketing | Vera Compliance | Lane Finance | Felix Recruiting | Aria(aria.js) NLP Knowledge | KAIROS(kairos.js) Background Tasks 15min | AutoDream(autodream.js) 3am Memory
MCP: mcp-gmail.js /email | mcp-gcal.js /cal | mcp-agents.js /agents registry
TWILIO: twilio-diag.js diagnostics | twilio-sms.js webhook:3200 | twilio-auto.js natural language API
BROWSER: modules/namecheap.js Playwright domains | browser.js generic visit
TOOLS: next-task.js priorities | inbox.js auto-filing | queue.js offline retry | sweep.js 8am intel | evolve.js 3am evolution | news-miniapp.js :3100
BACKUP: backup.sh git 6h cron | backup-from-vps.sh M1 rsync 3am + AES-256"""

rooms["architect::data_flow"] = """IBIS DATA FLOW
Telegram msg -> ibis.js -> module handlers check first (inbox, tasks, twilio, namecheap, aria) -> if unhandled: classify() -> fast/long/strategic -> semanticSearch() + memSearch() -> context inject -> callModel() -> router.js -> OpenRouter API -> response to Telegram + saveMsg()
SMS in -> twilio-sms.js webhook:3200 -> forward Telegram + Sofia auto-reply -> sms_log table
Proactive -> proactive.js setInterval 60s -> time checks -> briefing/sweep/alert -> callModel() -> Telegram
KAIROS -> kairos.js 15min -> scan msgs for implicit tasks -> overdue check -> P1 nudges"""

# ── ROOM 2: HFC ───────────────────────────────────────────────────

rooms["hfc::overview"] = """HUMAN FREQUENCY CORP (HFC)
Soul's umbrella vision. The frequency at which humans operate, connect, and heal.
BUSINESSES: 1) 24 Hour Home Care NJ - licensed agency, NJ DOH regulated 2) Bonjour Home Care Group - home care brand/operations 3) ExNTER.com - content/philosophy/digital platform 4) OpenClaw AI - agent infrastructure (IBIS)
OPERATING MODEL: AI-first. IBIS orchestrates, each business has dedicated agent coverage.
COMPLIANCE: NJ DOH, CMS, HIPAA. Vera monitors. STAFFING: Felix pipeline. FINANCE: Lane tracking."""

rooms["hfc::homecare_operations"] = """HOME CARE OPERATIONS - 24 Hour HC NJ / Bonjour
SERVICES: Personal care, companionship, skilled nursing, respite care
INTAKE FLOW: Phone/SMS inquiry -> Sofia first contact -> coordinator assessment -> care plan -> caregiver match -> service start
BILLING: Medicaid, Medicare, private insurance, private pay
STAFFING: Caregiver recruit (Felix) -> onboarding -> scheduling -> supervision
COMPLIANCE: NJ DOH license, HIPAA, background checks, training reqs
METRICS: Client retention, caregiver retention, hours billed, satisfaction
IBIS COVERAGE: Sofia(comms) Henry(intel) Vera(compliance) Felix(recruiting) Lane(finance) Aria(knowledge extraction)"""

rooms["hfc::agent_assignments"] = """HFC AGENT ASSIGNMENTS
24 HOUR HOME CARE NJ: Primary Sofia+Henry+Vera | Secondary Felix+Lane
BONJOUR HOME CARE GROUP: Primary Sofia+Henry | Secondary Vera+Lane
EXNTER.COM: Primary Marcus+IBIS | Secondary Aria
OPENCLAW AI: Primary IBIS+AutoDream | Secondary All (they ARE the product)"""

# ── ROOM 3: Ibisus ─────────────────────────────────────────────────

rooms["ibisus::identity"] = """IBISUS - THE IBIS PUBLIC BRAND
IBIS = Intelligent Business Infrastructure System
Named after the ibis bird, sacred in Egyptian mythology, symbol of wisdom.
VOICE: Precise, direct, no fluff. Proactive not reactive. Warm but efficient.
POSITIONING: AI agent that actually runs a business, not a chatbot demo.
DIFFERENTIATOR: Production software managing real revenue-generating businesses.
CORE: Self-evolving (3am), self-healing (3-layer backup, auto-restart), multi-model routing, memory-persistent (SQLite + ChromaDB + MemPalace)"""

rooms["ibisus::ibishaas_vision"] = """IBISaaS - IBIS as a Service
CONCEPT: Package IBIS as deployable AI business operating system.
TARGET: Solo entrepreneurs, small agency owners, home care operators.
TIERS: Starter(Telegram+memory+briefing+tasks) | Pro(agents+SMS+email+calendar+scraping) | Enterprise(custom agents+Playwright+domains+compliance)
DISTRIBUTION: OpenIBIS(MIT open source core) | IBISaaS(managed hosted, monthly sub) | IBIS Custom(white-label)
STACK: Node.js, SQLite, OpenRouter, Telegram Bot API, Playwright
DEPLOY: Single VPS, pm2, <2min boot. MOAT: Agent roster pattern + memory palace + self-evolution loop"""

# ── ROOM 4: PixelRealEstate ────────────────────────────────────────

rooms["pixel::overview"] = """PIXEL REAL ESTATE - Digital Property Portfolio
CONCEPT: Every domain, page, pixel is real estate. Own it, develop it, monetize it.
ACTIVE: exnter.com (philosophy/content) | openclaw.ai (AI infrastructure brand)
STRATEGY: Acquire -> Develop -> Monetize -> Automate
Each property gets: landing page, SEO, content pipeline, analytics, AI automation.
MANAGEMENT: Namecheap module (/domains, nc ns, nc set-ns with /confirm)"""

rooms["pixel::content_strategy"] = """PIXEL CONTENT STRATEGY
EXNTER.COM: Voice=philosophical/provocative/authentic | Formats=TikTok+blog+X threads | Topics=consciousness,NLP,business philosophy,AI ethics,personal sovereignty | Pipeline=Aria extracts->Marcus ideates->sweep trends->IBIS schedules
OPENCLAW.AI: Voice=technical/builder-focused/open source | Formats=GitHub+tutorials+demos | Topics=AI agents,automation,self-evolving systems,Telegram bots
AUTOMATION: Marcus ideation -> sweep.js 8am trends -> proactive.js morning suggestions -> Aria NLP depth"""

rooms["pixel::site_architecture"] = """PIXEL SITE TABLE TEMPLATE
Fields per site: domain, status(active|parked|dev), hosting(VPS|Vercel|CF), nameservers, purpose(content|commerce|landing|app), monetization(ads|sub|leads|none), agent_coverage, last_updated
DNS CHANGES: Always require /confirm. MONITORING: Henry checks uptime daily.
CREATE TABLE IF NOT EXISTS pixel_sites (id INTEGER PRIMARY KEY, domain TEXT UNIQUE, status TEXT, hosting TEXT, nameservers TEXT, purpose TEXT, monetization TEXT, agent_coverage TEXT, updated_at INTEGER)"""

# ── ROOM 5: Golden Rules ──────────────────────────────────────────

rooms["golden::karpathy_four"] = """THE KARPATHY 4 - Core Operating Principles
1. ALWAYS BE KNOLLING - Keep everything organized. File immediately. No loose ends. Applied: inbox.js auto-files, KAIROS detects untracked tasks, AutoDream consolidates.
2. ALWAYS BE LEARNING - Every interaction is training data. Extract patterns, store insights. Applied: Aria ingests, sweep.js gathers intel, evolve.js researches nightly.
3. ALWAYS BE BUILDING - Bias toward action. Ship small, iterate fast. Applied: Evolution builds new skills nightly. Prototype > perfect plan.
4. ALWAYS BE COMPRESSING - Reduce complexity. Consolidate. Simplify. Applied: AutoDream deduplicates, compresses old messages, archives stale entries."""

rooms["golden::operating_laws"] = """IBIS OPERATING LAWS - Soul's Golden Rules
1. Never share YOUR-PHONE-NUMBER. Ever.
2. Soul's time is most expensive. Automate everything.
3. No fluff. Direct, precise, actionable.
4. Proactive > Reactive. Surface issues before asked.
5. Every decision serves the empire (24hr HC, Bonjour, ExNTER, OpenClaw).
6. Protect data. 3-layer backup. Encrypt. Never expose keys.
7. DNS changes require /confirm. No exceptions.
8. Log everything. Screenshots for browser. Audit trail always.
9. Self-improve nightly. Evolution not optional.
10. If VPS dies, IBIS boots from M1 in <2 minutes."""

rooms["golden::decision_framework"] = """IBIS DECISION FRAMEWORK - When deciding without Soul:
1. Protects Soul's interests? -> Do it.
2. Costs money? -> Flag it, wait for approval.
3. Reversible? -> Do it, report after.
4. Irreversible? -> /confirm required.
5. Urgent? -> Minimum safe action, alert Soul immediately.
6. Touches DNS/domains/billing? -> Never auto-execute.
7. Can wait until morning briefing? -> Queue it."""

# ── ROOM 6: Vault Room (expanded) ─────────────────────────────────

rooms["vault::infrastructure_map"] = """IBIS INFRASTRUCTURE MAP
VPS: Hetzner YOUR_VPS_IP | Ubuntu 24.04 LTS | Node v24.14.1 | PM2 v6.0.14 (systemd) | 37GB disk (34GB free) | 4GB RAM | Ports: 22(SSH) 3100(News) 3200(SMS Webhook) | Cron: backup.sh 6h
M1 MAC: ~/openclaw/ (dev) ~/openclaw-backup/ (resilience) | LaunchAgent com.ibis.backup 3am rsync | AES-256-CBC encryption | Node: /Users/iamnewearth/.nvm/versions/node/v24.14.0/bin/node
DATABASES: ibis_memory.db (messages, knowledge, tasks, sms_log, sms_contacts, browser_actions, aria_knowledge, aria_index, namecheap_creds, kairos_log, twilio_accounts) | palace.db (legacy)
EXTERNAL: Telegram Bot YOUR_TELEGRAM_BOT_ID | OpenRouter multi-model | Twilio +1XXXXXXXXXX | NewsAPI | Namecheap Playwright | DuckDuckGo search"""

rooms["vault::disaster_recovery"] = """DISASTER RECOVERY RUNBOOK
VPS DOWN (temp): pm2 auto-restarts. Reboot: systemd->pm2->IBIS. Wait.
VPS LOST (perm): cd ~/openclaw-backup/openclaw && cp ../databases/*.db . && cp ../.env.backup .env && cp ../.env.twilio.backup .env.twilio && npm install && pm2 start ibis.js. Recovery: <2min.
NEW VPS: rsync backup to new server, npm install, pm2 start+save+startup, update Twilio webhook. Recovery: <10min.
M1 LOST: VPS has git (6h snapshots), clone to new machine.
BOTH LOST: GitHub ibis-sovereign-backup (when connected) + encrypted .tar.gz.enc portable files.
VERIFY: /backup-status in Telegram."""

# ── WRITE ALL ──────────────────────────────────────────────────────

count = 0
for key, value in rooms.items():
    db.execute("INSERT OR REPLACE INTO knowledge (key, value) VALUES (?, ?)", (key, value))
    count += 1

db.commit()

total = db.execute("SELECT COUNT(*) FROM knowledge").fetchone()[0]
room_names = sorted(set(k.split("::")[0] for k in rooms.keys()))

print(f"Stored {count} entries across {len(room_names)} rooms")
print(f"Rooms: {', '.join(room_names)}")
print(f"Total knowledge entries: {total}")
