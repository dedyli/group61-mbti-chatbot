'use strict';

/**
 * Netlify function: process-chat
 * - service_type = "personality": returns strict JSON (kept intact)
 * - service_type = "conflict": returns clean human text; unwraps JSON if model slips
 */

const { randomUUID } = require('crypto');

// ---------- Environment helpers ----------
const env = (k, d = undefined) => (process.env[k] ?? d);

const OPENAI_API_KEY = env('OPENAI_API_KEY');
const OPENAI_BASE_URL = (env('OPENAI_BASE_URL') || 'https://api.openai.com').replace(/\/+$/, '');
const MODEL_PERSONALITY = env('OPENAI_MODEL_PERSONALITY', 'gpt-4o-mini'); // keep as-is if you already set one
const MODEL_CONFLICT = env('OPENAI_MODEL_CONFLICT', 'gpt-4o-mini');
const ALLOWED_ORIGINS = (env('ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean);

const SUPABASE_URL = env('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = env('SUPABASE_SERVICE_KEY');
const SUPABASE_CONV_TABLE = env('SUPABASE_CONVERSATIONS_TABLE', 'conversations');

// ---------- Small utilities ----------
const jsonResponse = (status, body, extraHeaders = {}) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  },
  body: JSON.stringify(body),
});

const allowCORS = (origin, extra = {}) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  ...extra,
});

// Clean & bound history depth (keep last 20 turns for better context)
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

function normalizeServiceType(v) {
  if (typeof v !== 'string') return 'personality';
  const s = v.trim().toLowerCase();
  return (s === 'conflict' || s === 'personality') ? s : 'personality';
}

// ---------- Prompts ----------
const SYSTEM_PERSONALITY = [
  'You are Mind-Mapper AI, a careful MBTI-oriented assistant.',
  'Output MUST be a single valid JSON object (no code fences, no prose).',
  'Schema (keys, lowercase, snake_case):',
  '- ready_for_analysis: boolean',
  '- one_liner: string',
  '- reasoning: string',
  '- progress: { current_step: number, total_steps: number, step_description: string }',
  '- dimensions_explored: { energy_source: boolean, information_processing: boolean, decision_making: boolean, lifestyle: boolean }',
  '- summary: string',
  '- next_steps: string[]',
  'Never include markdown, code blocks, or extra commentary. Only JSON.',
].join(' ');

const SYSTEM_CONFLICT = [
  'You are a conflict resolution specialist: empathetic, concise, practical.',
  'Speak in natural, flowing text suitable for a chat bubble (no lists unless asked).',
  'Guide the user through understanding perspectives, identifying needs, and drafting a respectful message.',
  'Do NOT output JSON, keys, code fences, or structured objects—plain text only.',
].join(' ');

// ---------- OpenAI Call ----------
async function callOpenAI({ messages, serviceType, model }) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set.');
  }

  const sys = (serviceType === 'personality') ? SYSTEM_PERSONALITY : SYSTEM_CONFLICT;
  const payload = {
    model,
    messages: [
      { role: 'system', content: sys },
      ...messages,
    ],
    temperature: 0.4,
  };

  // Enforce JSON object for personality only
  if (serviceType === 'personality') {
    payload.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI error ${res.status}: ${text || res.statusText}`);
  }

  const data = await res.json();
  const aiContent = data?.choices?.[0]?.message?.content ?? '';

  // Personality: must be valid JSON; Conflict: must be human text
  if (serviceType === 'personality') {
    // Keep existing strict JSON behavior intact
    try {
      JSON.parse(aiContent);
    } catch {
      // Force a clear error to surface on client for debugging
      throw new Error('Model returned non-JSON for personality service.');
    }
    return aiContent.trim();
  } else {
    // Conflict: unwrap if model accidentally returned JSON
    let out = (aiContent || '').trim();
    if (out.startsWith('{')) {
      try {
        const j = JSON.parse(out);
        const parts = [
          j.one_liner,
          j.reasoning,
          Array.isArray(j.next_steps) ? j.next_steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : null,
          j.summary,
        ].filter(Boolean);
        out = parts.length ? parts.join('\n\n') : JSON.stringify(j, null, 2);
      } catch {
        // keep raw text
      }
    }
    return out;
  }
}

// ---------- Supabase Save (optional) ----------
async function saveConversation({ conversation_id, service_type, model, messages, reply, origin }) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { saved: false, id: conversation_id };

  const row = {
    conversation_id,
    service_type,
    model,
    messages,      // store as JSON
    reply,         // last assistant reply
    origin,        // site origin for troubleshooting
    created_at: new Date().toISOString(),
  };

  const res = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${encodeURIComponent(SUPABASE_CONV_TABLE)}`, {
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
    // Fail gracefully; the chat should still work
    return { saved: false, id: conversation_id, error: `Supabase ${res.status}: ${text || res.statusText}` };
  }

  const data = await res.json().catch(() => []);
  const id = data?.[0]?.conversation_id || conversation_id;
  return { saved: true, id };
}

// ---------- Handler ----------
exports.handler = async (event, context) => {
  const origin = event.headers?.origin || '';
  const corsOrigin =
    (ALLOWED_ORIGINS.length === 0) ? '*' :
    (ALLOWED_ORIGINS.includes(origin) ? origin : null);

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: allowCORS(corsOrigin),
      body: '',
    };
  }

  // Enforce CORS if configured
  if (ALLOWED_ORIGINS.length > 0 && !corsOrigin) {
    return jsonResponse(403, { error: 'Origin not allowed' }, allowCORS(null));
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' }, allowCORS(corsOrigin));
  }

  // Parse input
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' }, allowCORS(corsOrigin));
  }

  const service_type = normalizeServiceType(body.service_type ?? 'personality');
  const model = (service_type === 'personality') ? MODEL_PERSONALITY : MODEL_CONFLICT;

  const messages = sanitizeMessages(body.messages);
  if (messages.length === 0) {
    return jsonResponse(400, { error: 'messages[] required' }, allowCORS(corsOrigin, { 'X-Service-Type': service_type }));
  }

  // Generate a conversation id up front (so client can send feedback later even if save fails)
  const conversation_id = randomUUID();

  try {
    // Call model
    const reply = await callOpenAI({ messages, serviceType: service_type, model });

    // Save (best effort)
    await saveConversation({
      conversation_id,
      service_type,
      model,
      messages,
      reply,
      origin,
    });

    // Success
    return jsonResponse(
      200,
      { reply, conversation_id },
      allowCORS(corsOrigin, { 'X-Service-Type': service_type })
    );

  } catch (err) {
    const message = (err && err.message) ? err.message : 'Unknown error';
    return jsonResponse(
      500,
      { error: message, conversation_id },
      allowCORS(corsOrigin, { 'X-Service-Type': service_type })
    );
  }
};
