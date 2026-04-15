# 🦅 OpenIBIS — AI Business Operating System

IBIS (Intelligent Business Infrastructure System) is a self-evolving AI agent that runs your business from Telegram. Built for solo entrepreneurs and small teams.

## What IBIS Does

- **Morning Briefing** — 9am daily: priorities, empire update, news radar, backup status
- **Agent Roster** — 8 specialized agents: Henry (Ops), Sofia (Client Comms), Marcus (Marketing), Vera (Compliance), Lane (Finance), Felix (Recruiting), Aria (Knowledge), KAIROS (Background Tasks)
- **Memory Palace** — Persistent knowledge organized in browsable rooms
- **AutoDream** — 3am nightly: memory consolidation, pattern extraction, auto-room creation
- **SMS Integration** — Twilio-powered with Sofia auto-reply
- **Domain Management** — Playwright-driven Namecheap automation
- **Task System** — Priority queue with background detection
- **Self-Evolution** — Nightly research + skill generation cycle

## Quick Start

```bash
git clone https://github.com/iamnewearth/openibis.git
cd openibis
cp .env.example .env    # Fill in your API keys
npm install
node ibis.js            # Or: pm2 start ibis.js --name ibis
```

### Minimum Requirements
- Node.js 18+
- A Telegram bot token (from @BotFather)
- An OpenRouter API key (openrouter.ai)

### For Production
```bash
pm2 start ibis.js --name ibis --restart-delay=5000
pm2 save && pm2 startup
```

## Architecture

```
ibis.js (core) → router.js (multi-model AI) → OpenRouter API
     ↕                                            ↕
  SQLite DB          Telegram Bot API        Claude/GPT/Gemini
     ↕
  MemPalace (knowledge rooms)
     ↕
  Agent modules (henry, sofia, aria, kairos...)
```

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/palace` | Browse Memory Palace rooms |
| `/next` | Top priority task |
| `/tasks` | All open tasks |
| `/agents` | Agent roster |
| `/dream` | Trigger AutoDream cycle |
| `/email` | Check Gmail (needs setup) |
| `/cal` | Today's calendar (needs setup) |
| `/news` | Open news mini app |
| `/domains` | List Namecheap domains |
| `/twilio` | Diagnose Twilio accounts |
| `sms +1XXX message` | Send SMS |

## License

MIT — see [LICENSE](LICENSE)

Built by [Irina Fain](https://exnter.com) / OpenClaw AI
