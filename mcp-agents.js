// mcp-agents.js — Register all IBIS agents as MCP server cards
// Exposes agent capabilities as a structured registry for discovery and routing

const AGENT_REGISTRY = [
  {
    name: 'IBIS',
    role: 'Governing AI',
    description: 'Central orchestrator. Routes requests, manages memory, coordinates sub-agents.',
    capabilities: ['routing', 'memory', 'web-search', 'telegram', 'scheduling'],
    trigger: 'Default — all messages go through IBIS first',
    status: 'active',
  },
  {
    name: 'Henry Ivis',
    role: 'Operations',
    description: 'Daily web scraper and operations intelligence. Monitors regulatory changes, competitor moves, industry trends.',
    capabilities: ['web-scraping', 'firecrawl', 'daily-briefs'],
    trigger: '/henry, 7am daily auto-scrape',
    status: 'active',
  },
  {
    name: 'Marcus',
    role: 'Marketing',
    description: 'Content strategy, social media monitoring, brand voice for ExNTER and home care brands.',
    capabilities: ['content-generation', 'trend-analysis', 'social-monitoring'],
    trigger: '/marcus, content requests',
    status: 'active',
  },
  {
    name: 'Vera Wayne',
    role: 'Compliance',
    description: 'Regulatory compliance monitoring for home care industry. NJ DOH, CMS, HIPAA tracking.',
    capabilities: ['regulation-tracking', 'compliance-audit', 'alert-system'],
    trigger: '/vera, compliance queries',
    status: 'active',
  },
  {
    name: 'Sofia Elmer',
    role: 'Home Care Voice',
    description: 'Patient/caregiver communication specialist. Handles sensitive messaging and care coordination.',
    capabilities: ['empathetic-messaging', 'care-coordination', 'family-communication'],
    trigger: '/sofia, care-related messages',
    status: 'active',
  },
  {
    name: 'Lane',
    role: 'Finance',
    description: 'Financial tracking, invoicing, revenue monitoring across all businesses.',
    capabilities: ['financial-analysis', 'invoice-tracking', 'revenue-reports'],
    trigger: '/lane, finance queries',
    status: 'active',
  },
  {
    name: 'Felix',
    role: 'Recruiting',
    description: 'Caregiver and staff recruiting pipeline. Job posting, candidate screening, onboarding.',
    capabilities: ['job-posting', 'candidate-screening', 'onboarding-flows'],
    trigger: '/felix, recruiting tasks',
    status: 'active',
  },
  {
    name: 'Aria',
    role: 'NLP/Hypnosis Knowledge',
    description: 'Ingests and retrieves from NLP/hypnosis knowledge library. Semantic search over therapeutic frameworks.',
    capabilities: ['knowledge-ingestion', 'semantic-search', 'therapeutic-frameworks'],
    trigger: '/aria, NLP/hypnosis queries',
    status: 'active',
  },
  {
    name: 'KAIROS',
    role: 'Background Task Detection',
    description: 'Always-on background loop. Detects implicit tasks, overdue items, and nudges on critical priorities.',
    capabilities: ['task-detection', 'deadline-tracking', 'proactive-nudges'],
    trigger: 'Automatic — runs every 15min during waking hours',
    status: 'active',
  },
  {
    name: 'AutoDream',
    role: 'Memory Consolidation',
    description: 'Nightly memory cleanup. Deduplicates, archives stale entries, extracts behavioral patterns.',
    capabilities: ['memory-consolidation', 'pattern-extraction', 'history-compression'],
    trigger: '3am nightly, or /dream',
    status: 'active',
  },
];

function getAgentCard(name) {
  return AGENT_REGISTRY.find(a => a.name.toLowerCase() === name.toLowerCase());
}

function listAgents() {
  return AGENT_REGISTRY;
}

function setupMcpAgents(bot, chatId) {
  bot.on('message', async (msg) => {
    if (msg.chat.id !== chatId) return;
    const text = (msg.text || '').trim();

    if (text === '/agents' || text === '/roster') {
      const lines = AGENT_REGISTRY.map(a => {
        const icon = a.status === 'active' ? '🟢' : '🔴';
        return `${icon} *${a.name}* — ${a.role}\n   ${a.description.slice(0, 80)}`;
      });
      await bot.sendMessage(chatId, `🏛 *IBIS Agent Roster*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown' });
      return;
    }

    if (text.startsWith('/agent ')) {
      const name = text.slice(7).trim();
      const card = getAgentCard(name);
      if (!card) { await bot.sendMessage(chatId, `Agent "${name}" not found. Say /agents to see all.`); return; }
      const caps = card.capabilities.map(c => `\`${c}\``).join(', ');
      await bot.sendMessage(chatId,
        `🏛 *${card.name}* — ${card.role}\n\n${card.description}\n\n*Capabilities:* ${caps}\n*Trigger:* ${card.trigger}\n*Status:* ${card.status}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
  });

  console.log('✅ MCP Agent Registry active — /agents, /agent <name>');
}

module.exports = { setupMcpAgents, getAgentCard, listAgents, AGENT_REGISTRY };
