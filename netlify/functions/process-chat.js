// File Location: netlify/functions/process-chat.js

import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// Supabase (optional; safe to keep even if not configured)
// ─────────────────────────────────────────────────────────────────────────────
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter setup
// ─────────────────────────────────────────────────────────────────────────────
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS = {
  Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'HTTP-Referer': 'https://group61project.netlify.app/', // your site
  'X-Title': 'Mind-Mapper AI'
};

// Models ordered by reliability and quality for MBTI analysis
const PREFERRED_MODELS = [
  'anthropic/claude-3-haiku',            // very fast, safe
  'google/gemini-flash-1.5',             // very fast, cheap
  'meta-llama/llama-3.1-8b-instruct',    // ultra low-cost fallback
  'deepseek/deepseek-chat'               // last resort
];

// ─────────────────────────────────────────────────────────────────────────────
// MBTI-optimized system prompt (STRICT JSON output)
// ─────────────────────────────────────────────────────────────────────────────
const MBTI_SYSTEM_PROMPT = `You are Mind-Mapper AI, a friendly personality coach who helps people understand themselves better.

INSTRUCTIONS:
1) Use simple, everyday language a high school student uses.
2) Keep responses short and conversational.
3) Avoid complex psychology terms—explain things simply.
4) Be warm, friendly, and encouraging—like talking to a friend.
5) Use relatable examples from daily life, school, or social situations.

LANGUAGE RULES:
- Instead of "Extraverted Feeling (Fe)" → say "caring about group harmony".
- Instead of "Introverted Sensing (Si)" → say "remembering details and past experiences".
- Instead of "cognitive functions" → say "how your mind works".
- Instead of "preferences" → say "what you're naturally good at".
- Use "you might be someone who..." rather than clinical labels.

RESPONSE FORMAT (STRICT):
- Always respond with a single, valid JSON object only. No prose, no Markdown, no code fences.
- Use this schema:
{
  "type": "string",           // MBTI code like "INTJ" (best-guess)
  "confidence": 0.0,          // number from 0 to 1
  "strengths": ["string"],    // 2–5 short bullets
  "growth_tips": ["string"],  // 2–5 short bullets
  "one_liner": "string"       // <= 20 words friendly summary
}

RESPONSE STYLE:
- Casual and friendly, not academic.
- Use "you" and "your" to make it personal.
- Give practical examples a student can relate to.
- Keep it safe and supportive, avoiding stereotypes or sensitive claims.
`;

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
function isValidText(text) {
  if (!text || typeof text !== 'string' || text.length < 5) return false;
  // Basic garble/HTML detection
  if (text.includes('<!DOCTYPE') || text.includes('<html')) return false;
  if (/(.)\1{10,}/.test(text)) return false;                     // long repeats
  if (/[A-Za-z]{80,}/.test(text)) return false;                  // too-long "word"
  return true;
}

// Robust JSON parse from API responses (handles HTML pages & fenced JSON)
async function getJsonResponse(response) {
  const responseText = await response.text();
  const ct = (response.headers && response.headers.get && response.headers.get('content-type')) || '';

  if (!response.ok) {
    console.error('API request failed. Status:', response.status);
    console.error('Response preview:', responseText.substring(0, 200));
    if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
      throw new Error('Invalid JSON response from API');
    }
    if (response.status === 401) throw new Error('Invalid API key');
    if (response.status === 429) throw new Error('Rate limit exceeded');
    throw new Error(`API error ${response.status}`);
  }

  // Happy path when content-type is JSON
  if (ct.includes('application/json')) {
    try {
      return JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse JSON (JSON content-type):', responseText.substring(0, 200));
    }
  }

  // Heuristics — try to extract JSON if the model added text or fences
  try {
    const fenceMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) return JSON.parse(fenceMatch[1]);
    const start = responseText.indexOf('{');
    const end = responseText.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(responseText.slice(start, end + 1));
    }
  } catch (e) {
    console.error('Heuristic JSON extraction failed:', e.message);
  }

  console.error('Failed to parse JSON:', responseText.substring(0, 200));
  throw new Error('Invalid JSON response from API');
}

async function createEmbedding(text) {
  try {
    const embeddingResponse = await fetch(`${OPENROUTER_API_BASE}/embeddings`, {
      method: 'POST',
      headers: OPENROUTER_HEADERS,
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',
        input: text
      })
    });

    if (!embeddingResponse.ok) {
      const preview = await embeddingResponse.text();
      console.log('Embedding error preview:', preview.substring(0, 200));
      return null;
    }

    const json = await embeddingResponse.json();
    if (json && json.data && json.data[0] && json.data[0].embedding) {
      return json.data[0].embedding;
    }
  } catch (err) {
    console.log('Embedding creation failed:', err.message);
  }
  return null;
}

async function tryModelsInOrder(messages) {
  const modelParams = {
    'anthropic/claude-3-haiku':          { max_tokens: 150, temperature: 0.7 },
    'google/gemini-flash-1.5':           { max_tokens: 150, temperature: 0.7 },
    'meta-llama/llama-3.1-8b-instruct':  { max_tokens: 130, temperature: 0.6, top_p: 0.9 },
    'deepseek/deepseek-chat':            { max_tokens: 120, temperature: 0.6 }
  };

  for (const model of PREFERRED_MODELS) {
    try {
      const params = modelParams[model] || { max_tokens: 150, temperature: 0.7 };

      const chatResponse = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: OPENROUTER_HEADERS,
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: 'json_object' }, // force JSON-only output
          ...params
        })
      });

      const chatJson = await getJsonResponse(chatResponse);
      if (!chatJson?.choices?.[0]) {
        console.log(`${model}: invalid response structure`);
        continue;
      }

      let content = chatJson.choices[0].message?.content;
      if (typeof content === 'object') content = JSON.stringify(content);
      if (!isValidText(content)) {
        console.log(`${model}: garbled or invalid text`);
        continue;
      }

      // Ensure parsable JSON per our schema
      try {
        const parsed = typeof content === 'string' ? JSON.parse(content) : content;
        // minimal sanity checks
        if (!parsed || typeof parsed !== 'object') throw new Error('Not an object');
        if (!('type' in parsed)) parsed.type = 'Unknown';
        if (!('confidence' in parsed)) parsed.confidence = 0.0;
        if (!('strengths' in parsed)) parsed.strengths = [];
        if (!('growth_tips' in parsed)) parsed.growth_tips = [];
        if (!('one_liner' in parsed)) parsed.one_liner = '';
        console.log(`Success with ${model}`);
        return JSON.stringify(parsed);
      } catch (e) {
        console.log(`${model}: JSON validation failed (${e.message})`);
        continue;
      }
    } catch (err) {
      console.log(`Trying model ${model} failed:`, err.message);
      // continue to next model
    }
  }

  throw new Error('All models failed to return valid JSON.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Netlify handler
// ─────────────────────────────────────────────────────────────────────────────
export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { messages } = JSON.parse(event.body || '{}');
    if (!Array.isArray(messages) || messages.length === 0) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Invalid payload: messages[] required' })
      };
    }

    const latest = messages[messages.length - 1]?.content || '';

    console.log('Processing MBTI analysis request...');

    // (Optional) semantic search preparation
    let queryEmbedding = null;
    try {
      queryEmbedding = await createEmbedding(latest);
    } catch (_) {}

    // Build final messages with our strict system prompt
    const finalMessages = [
      { role: 'system', content: MBTI_SYSTEM_PROMPT },
      ...messages
    ];

    // Get AI response via fallback chain
    const aiResponse = await tryModelsInOrder(finalMessages);
    console.log('MBTI analysis generated successfully');

    // Persist conversation (best-effort)
    try {
      const fullConversation = [...messages, { role: 'assistant', content: aiResponse }];
      await supabase.from('conversations').insert({
        conversation_history: fullConversation,
        embedding: queryEmbedding
      });
    } catch (e) {
      console.log('Supabase insert skipped/failed:', e.message);
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reply: aiResponse })
    };
  } catch (error) {
    console.error('Critical error in process-chat:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: 'Service temporarily unavailable. Please try again.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};
