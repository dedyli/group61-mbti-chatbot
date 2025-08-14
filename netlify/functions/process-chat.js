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
  'HTTP-Referer': 'https://group61project.netlify.app/',
  'X-Title': 'Mind-Mapper AI'
};

// Models ordered by reliability and quality for MBTI analysis
const PREFERRED_MODELS = [
  'anthropic/claude-3-haiku',
  'google/gemini-flash-1.5',
  'meta-llama/llama-3.1-8b-instruct',
  'deepseek/deepseek-chat'
];

// ─────────────────────────────────────────────────────────────────────────────
// MBTI-optimized system prompt (STRICT JSON output)
// ─────────────────────────────────────────────────────────────────────────────
const MBTI_SYSTEM_PROMPT = `You are Mind-Mapper AI, a friendly personality coach who helps people understand themselves better.

CRITICAL: You MUST respond with ONLY a valid JSON object. No explanations, no text before or after.

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
Respond with ONLY this JSON structure:
{
  "type": "INTJ",
  "confidence": 0.8,
  "strengths": ["You're great at seeing the big picture", "You think things through carefully"],
  "growth_tips": ["Try sharing your ideas more often", "Don't be afraid to ask for help"],
  "one_liner": "A thoughtful planner who sees possibilities others miss"
}

RESPONSE REQUIREMENTS:
- type: Must be a 4-letter MBTI code (like "INTJ", "ESFP", etc.)
- confidence: Number between 0.0 and 1.0
- strengths: Array of 2-5 friendly, encouraging statements
- growth_tips: Array of 2-5 practical, supportive suggestions
- one_liner: Max 20 words, friendly personality summary`;

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
function isValidText(text) {
  if (!text || typeof text !== 'string' || text.length < 5) return false;
  if (text.includes('<!DOCTYPE') || text.includes('<html')) return false;
  if (/(.)\1{10,}/.test(text)) return false;
  if (/[A-Za-z]{80,}/.test(text)) return false;
  return true;
}

// Enhanced JSON response handler with better error logging
async function getJsonResponse(response) {
  const responseText = await response.text();
  const ct = (response.headers && response.headers.get && response.headers.get('content-type')) || '';
  
  console.log('=== API Response Debug Info ===');
  console.log('Status:', response.status);
  console.log('Content-Type:', ct);
  console.log('Response Length:', responseText.length);
  console.log('Response Preview:', responseText.substring(0, 500));
  console.log('================================');
  
  if (!response.ok) {
    console.error('API request failed. Full response:', responseText);
    if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
      throw new Error('API returned HTML instead of JSON - possible rate limit or server error');
    }
    if (response.status === 401) throw new Error('Invalid API key');
    if (response.status === 429) throw new Error('Rate limit exceeded');
    if (response.status === 503) throw new Error('Service temporarily unavailable');
    throw new Error(`API error ${response.status}: ${responseText.substring(0, 200)}`);
  }
  
  // Try parsing as JSON first
  if (ct.includes('application/json')) {
    try {
      const parsed = JSON.parse(responseText);
      console.log('Successfully parsed JSON response');
      return parsed;
    } catch (e) {
      console.error('Failed to parse JSON despite JSON content-type:', e.message);
      console.error('Raw response:', responseText);
    }
  }
  
  // Fallback: try to extract JSON from mixed content
  try {
    // Try to find JSON code blocks
    const fenceMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
      console.log('Found JSON in code fence');
      return JSON.parse(fenceMatch[1]);
    }
    
    // Try to find JSON object
    const start = responseText.indexOf('{');
    const end = responseText.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      const jsonStr = responseText.slice(start, end + 1);
      console.log('Extracted JSON:', jsonStr);
      return JSON.parse(jsonStr);
    }
    
    // Last resort: try parsing the whole thing
    return JSON.parse(responseText);
  } catch (e) {
    console.error('All JSON parsing attempts failed:', e.message);
    console.error('Final response text:', responseText);
  }
  
  throw new Error('Could not extract valid JSON from API response');
}

async function createEmbedding(text) {
  try {
    console.log('Creating embedding for text length:', text.length);
    const embeddingResponse = await fetch(`${OPENROUTER_API_BASE}/embeddings`, {
      method: 'POST',
      headers: OPENROUTER_HEADERS,
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',
        input: text.substring(0, 8000) // Limit input length
      })
    });
    
    if (!embeddingResponse.ok) {
      const preview = await embeddingResponse.text();
      console.log('Embedding error:', embeddingResponse.status, preview.substring(0, 200));
      return null;
    }
    
    const json = await embeddingResponse.json();
    if (json && json.data && json.data[0] && json.data[0].embedding) {
      console.log('Successfully created embedding');
      return json.data[0].embedding;
    } else {
      console.log('Invalid embedding response structure:', json);
    }
  } catch (err) {
    console.log('Embedding creation failed:', err.message);
  }
  return null;
}

async function tryModelsInOrder(messages) {
  const modelParams = {
    'anthropic/claude-3-haiku': { max_tokens: 200, temperature: 0.7 },
    'google/gemini-flash-1.5': { max_tokens: 200, temperature: 0.7 },
    'meta-llama/llama-3.1-8b-instruct': { max_tokens: 180, temperature: 0.6, top_p: 0.9 },
    'deepseek/deepseek-chat': { max_tokens: 160, temperature: 0.6 }
  };
  
  let lastError = null;
  
  for (const model of PREFERRED_MODELS) {
    try {
      console.log(`\n=== Trying model: ${model} ===`);
      const params = modelParams[model] || { max_tokens: 200, temperature: 0.7 };
      
      const requestBody = {
        model,
        messages,
        ...params
      };
      
      // Only add response_format for models that support it
      if (model.includes('gpt-') || model.includes('claude-')) {
        requestBody.response_format = { type: 'json_object' };
      }
      
      console.log('Request body:', JSON.stringify(requestBody, null, 2));
      
      const chatResponse = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: OPENROUTER_HEADERS,
        body: JSON.stringify(requestBody)
      });
      
      const chatJson = await getJsonResponse(chatResponse);
      console.log('Raw API response:', JSON.stringify(chatJson, null, 2));
      
      if (!chatJson?.choices?.[0]) {
        console.log(`${model}: invalid response structure - no choices`);
        lastError = new Error('Invalid response structure');
        continue;
      }
      
      let content = chatJson.choices[0].message?.content;
      console.log('Content from API:', typeof content, content);
      
      if (!content) {
        console.log(`${model}: no content in response`);
        lastError = new Error('No content in response');
        continue;
      }
      
      // Handle object content
      if (typeof content === 'object') {
        console.log('Content is object, stringifying');
        content = JSON.stringify(content);
      }
      
      if (!isValidText(content)) {
        console.log(`${model}: content failed validation`);
        lastError = new Error('Content failed validation');
        continue;
      }
      
      // Validate and clean up JSON
      try {
        let parsed;
        if (typeof content === 'string') {
          // Remove any markdown formatting
          const cleanContent = content.replace(/```json\s*|\s*```/g, '').trim();
          parsed = JSON.parse(cleanContent);
        } else {
          parsed = content;
        }
        
        // Validate required fields and add defaults
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Parsed content is not an object');
        }
        
        // Ensure all required fields exist with proper types
        const result = {
          type: typeof parsed.type === 'string' ? parsed.type : 'Unknown',
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
          strengths: Array.isArray(parsed.strengths) ? parsed.strengths : ['Analysis pending'],
          growth_tips: Array.isArray(parsed.growth_tips) ? parsed.growth_tips : ['Try again later'],
          one_liner: typeof parsed.one_liner === 'string' ? parsed.one_liner : 'Personality analysis in progress'
        };
        
        console.log(`✓ Success with ${model}`);
        console.log('Final result:', result);
        return JSON.stringify(result);
        
      } catch (e) {
        console.log(`${model}: JSON validation failed:`, e.message);
        console.log('Content that failed:', content);
        lastError = e;
        continue;
      }
      
    } catch (err) {
      console.log(`${model} failed with error:`, err.message);
      lastError = err;
      continue;
    }
  }
  
  // If all models fail, return a safe fallback
  console.log('All models failed. Last error:', lastError?.message);
  const fallback = {
    type: "Unknown",
    confidence: 0.0,
    strengths: ["Unable to analyze at this time"],
    growth_tips: ["Please try again in a moment"],
    one_liner: "Analysis temporarily unavailable"
  };
  
  return JSON.stringify(fallback);
}

// ─────────────────────────────────────────────────────────────────────────────
// Netlify handler
// ─────────────────────────────────────────────────────────────────────────────
export const handler = async (event) => {
  console.log('\n🚀 Function invoked with method:', event.httpMethod);
  console.log('Headers:', JSON.stringify(event.headers, null, 2));
  
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
    console.log('❌ Method not allowed:', event.httpMethod);
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  try {
    // Environment variable checks
    console.log('🔧 Checking environment variables...');
    console.log('Available env vars:', Object.keys(process.env).filter(key => key.includes('API') || key.includes('KEY')));
    console.log('OPENROUTER_API_KEY exists:', !!process.env.OPENROUTER_API_KEY);
    console.log('OPENROUTER_API_KEY length:', process.env.OPENROUTER_API_KEY?.length || 0);
    
    if (!process.env.OPENROUTER_API_KEY) {
      console.error('❌ Missing OPENROUTER_API_KEY environment variable');
      console.error('All environment variables:', Object.keys(process.env));
      throw new Error('Configuration error: API key not set');
    }
    console.log('✓ API key is set');
    
    // Parse request body
    console.log('📥 Parsing request body...');
    const body = event.body || '{}';
    console.log('Raw body:', body);
    
    const { messages } = JSON.parse(body);
    console.log('Parsed messages:', messages);
    
    if (!Array.isArray(messages) || messages.length === 0) {
      console.log('❌ Invalid messages payload');
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
    console.log('📝 Processing MBTI analysis for message:', latest.substring(0, 100));
    
    // Optional embedding creation (non-blocking)
    let queryEmbedding = null;
    try {
      queryEmbedding = await createEmbedding(latest);
    } catch (err) {
      console.log('⚠️ Embedding creation failed (non-critical):', err.message);
    }
    
    // Build final messages
    const finalMessages = [
      { role: 'system', content: MBTI_SYSTEM_PROMPT },
      ...messages
    ];
    
    console.log('🤖 Sending to AI models...');
    const aiResponse = await tryModelsInOrder(finalMessages);
    console.log('✅ AI response generated:', aiResponse.substring(0, 200));
    
    // Optional database save (non-blocking)
    if (supabase && queryEmbedding) {
      try {
        const fullConversation = [...messages, { role: 'assistant', content: aiResponse }];
        await supabase.from('conversations').insert({
          conversation_history: fullConversation,
          embedding: queryEmbedding
        });
        console.log('✅ Conversation saved to database');
      } catch (e) {
        console.log('⚠️ Database save failed (non-critical):', e.message);
      }
    }
    
    console.log('🎉 Request completed successfully');
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reply: aiResponse })
    };
    
  } catch (error) {
    console.error('💥 Critical error in process-chat:', error);
    console.error('Stack trace:', error.stack);
    
    // Return detailed error for debugging
    const errorResponse = {
      error: 'Service temporarily unavailable',
      message: error.message,
      timestamp: new Date().toISOString()
    };
    
    // Add more details in development
    if (process.env.NODE_ENV === 'development') {
      errorResponse.stack = error.stack;
      errorResponse.details = error.toString();
    }
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(errorResponse)
    };
  }
};