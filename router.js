// router.js — OpenRouter model routing for IBIS/Zorian
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

const MODELS = {
  fast:      "openai/gpt-4o-mini",
  long:      "google/gemini-2.0-flash-001",
  reasoning: "anthropic/claude-sonnet-4-5",
  premium:   "anthropic/claude-opus-4",
};

function selectModel(task = "fast") {
  return MODELS[task] || MODELS.fast;
}

async function callOpenRouter(messages, task = "fast", systemPrompt = null) {
  const model = selectModel(task);
  const body = {
    model,
    messages: systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages,
    max_tokens: task === "reasoning" ? 2048 : 1024,
    temperature: 0.7,
  };
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://openclaw.ai",
      "X-Title": "IBIS/Zorian",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error [${res.status}]: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "[no response]";
}

module.exports = { callOpenRouter, selectModel, MODELS };
