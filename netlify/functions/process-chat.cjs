'use strict';

/**
 * Single entry for two services:
 * - service_type = "personality": strict JSON
 * - service_type = "conflict": plain text (unwraps JSON if model slips)
 */

const { randomUUID } = require('crypto');

// ---------- Env ----------
const env = (k, d) => (process.env[k] ?? d);
const OPENAI_API_KEY = env('OPENAI_API_KEY');
const OPENAI_BASE_URL = (env('OPENAI_BASE_URL', 'https://api.openai.com')).replace(/\/+$/, '');
const MODEL_PERSONALITY = env('OPENAI_MODEL_PERSONALITY', 'gpt-4o-mini');
const MODEL_CONFLICT = env('OPENAI_MODEL_CONFLICT', 'gpt-4o-mini');
const ALLOWED_ORIGINS = (env('ALLOWED_ORIGINS', '') || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const SUPABASE_URL = env('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = env('SUPABASE_SERVICE_KEY');
const SUPABASE_CONV_TABLE = env('SUPABASE_CONVERSATIONS_TABLE', 'conversations');

// ---------- Helpers ----------
const jsonResponse = (status, body, headers = {}) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  body: JSON.stringify(body),
});

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
});

function normalizeServiceType(v) {
  if (typeof v !== 'string') return 'personality';
  const s = v.trim().toLowerCase();
  return (s === 'conflict' || s === 'personality') ? s : 'personality';
}

function sanitizeMessages(input) {
  if (!Array.isArray(input)) return [];
  const mapped = input
    .filter(m => m && typeof m === 'object' && m.content)
    .map(m => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user'),
      content: String(m.content).slice(0, 6000).trim(),
    }));
  return mapped.slice(-20);
}

// ---------- System prompts ----------
const SYSTEM_PERSONALITY = [
  'You are Mind-Mapper AI, a careful MBTI-oriented assistant.',
  'Output MUST be a single valid JSON object (no code fences, no prose).',
  'Schema (snake_case): ready_for_analysis:boolean, one_liner:string, reasoning:string,',
  'progress:{current_step:number,total_steps:number,step_description:string},',
  'dimensions_explored:{energy_source:boolean,information_processing:boolean,decision_making:boolean,lifestyle:boolean},',
  'summary:string, next_steps:string[].',
  'Never include markdown, code blocks, or extra commentary. Only JSON.',
].join(' ');

const SYSTEM_CONFLICT = [
  'You are a conflict resolution specialist: empathetic, concise, practical.',
  'Speak in natural, flowing text suitable for a chat bubble (no JSON, no code fences).',
  'Guide the user through understanding perspectives, identifying needs, and drafting a respectful message.',
  'Do NOT output JSON, keys, or structured objects—plain conversational text only.',
].join(' ');

// ---------- Model call ----------
async function callOpenAI({ messages, serviceType, model }) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');

  const system = (serviceType === 'personality') ? SYSTEM_PERSONALITY : SYSTEM_CONFLICT;
  const payload = {
    model,
    temperature: 0.4,
    messages: [{ role: 'system', content: system }, ...messages],
  };

  // Enforce JSON output for personality only
  if (serviceType === 'personality') {
    payload.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI error ${res.status}: ${text || res.statusText}`);
  }

  const data = await res.json().catch(() => ({}));
  const aiContent = data?.choices?.[0]?.message?.content ?? '';
  let out = (aiContent || '').trim();

  if (serviceType === 'personality') {
    // Must be valid JSON
    try { JSON.parse(out); }
    catch { throw new Error('Model returned non-JSON for personality service.'); }
    return out;
  }

  // serviceType === 'conflict' → must be plain text; unwrap JSON if slipped
  if (out.startsWith('{')) {
    try {
      const j = JSON.parse(out);
      const parts = [
        j.one_liner,
        j.reasoning,
        Array.isArray(j.next_steps) ? j.next_steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : null,
        j.summary,
      ].filter(Boolean);
      if (parts.length) out = parts.join('\n\n');
    } catch {
      // keep raw if parse fails
    }
  }
  return out;
}

// ---------- Supabase save (optional) ----------
async function saveConversation({ conversation_id, service_type, model, messages, reply, origin }) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { saved: false, id: conversation_id };

  const row = {
    conversation_id,
    service_type,
    model,
    messages,            // JSON array
    reply,               // last assistant reply
    origin,              // request origin
    created_at: new Date().toISOString(),
  };

  const url = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${encodeURIComponent(SUPABASE_CONV_TABLE)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { saved: false, id: conversation_id, error: `Supabase ${res.status}: ${text || res.statusText}` };
  }

  const data = await res.json().catch(() => []);
  return { saved: true, id: data?.[0]?.conversation_id || conversation_id };
}

// ---------- Handler ----------
exports.handler = async (event) => {
  const origin = event.headers?.origin || '';
  const allowOrigin = (ALLOWED_ORIGINS.length === 0)
    ? '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : null);

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(allowOrigin), body: '' };
  }

  // CORS gate
  if (ALLOWED_ORIGINS.length > 0 && !allowOrigin) {
    return jsonResponse(403, { error: 'Origin not allowed' }, corsHeaders(null));
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' }, corsHeaders(allowOrigin));
  }

  // Parse body
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResponse(400, { error: 'Invalid JSON body' }, corsHeaders(allowOrigin)); }

  let { messages, service_type } = body;
  service_type = normalizeServiceType(service_type ?? 'personality');
  const model = (service_type === 'personality') ? MODEL_PERSONALITY : MODEL_CONFLICT;

  messages = sanitizeMessages(messages);
  if (messages.length === 0) {
    return jsonResponse(400, { error: 'messages[] required' }, { ...corsHeaders(allowOrigin), 'X-Service-Type': service_type });
  }

  const conversation_id = randomUUID();

  try {
    const reply = await callOpenAI({ messages, serviceType: service_type, model });

    // Best-effort save (does not block success)
    await saveConversation({
      conversation_id,
      service_type,
      model,
      messages,
      reply,
      origin,
    });

    return jsonResponse(
      200,
      { reply, conversation_id },
      { ...corsHeaders(allowOrigin), 'X-Service-Type': service_type }
    );
  } catch (err) {
    const message = (err && err.message) ? err.message : 'Unknown error';
    return jsonResponse(
      500,
      { error: message, conversation_id },
      { ...corsHeaders(allowOrigin), 'X-Service-Type': service_type }
    );
  }
};
