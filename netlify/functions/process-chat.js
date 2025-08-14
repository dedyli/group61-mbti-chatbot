// Fixed process-chat.js with proper conversation handling

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS = {
  Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'HTTP-Referer': 'https://group61project.netlify.app/',
  'X-Title': 'Mind-Mapper AI'
};

// UPDATED: More diverse models and better parameters
const PREFERRED_MODELS = [
  'anthropic/claude-3.5-haiku',  // Updated to newer version
  'google/gemini-flash-1.5-8b',
  'meta-llama/llama-3.1-8b-instruct',
  'openai/gpt-4o-mini'  // Added GPT model as alternative
];

// FIXED: More dynamic system prompt that encourages variety
const MBTI_SYSTEM_PROMPT = `You are Mind-Mapper AI, a friendly personality coach.

CRITICAL RULES:
1) Output ONLY valid JSON (no code fences, no extra text)
2) Base content on the conversation so far; DO NOT reuse placeholder values
3) Vary wording and insights across turns; avoid repetition
4) If information is thin, lower confidence and include one targeted follow-up in growth_tips

OUTPUT SCHEMA (placeholders; do NOT copy them verbatim):
{
  "type": "<ISTJ|ISFJ|INFJ|INTJ|ISTP|ISFP|INFP|INTP|ESTP|ESFP|ENFP|ENTP|ESTJ|ESFJ|ENFJ|ENTJ>",
  "confidence": <float between 0.0 and 1.0>,
  "strengths": ["<short bullet>", "<short bullet>", "<short bullet>"],
  "growth_tips": ["<short bullet>", "<short bullet>", "<short bullet>"],
  "one_liner": "<one-sentence summary>"
}

VARIETY LOGIC:
- Early conversation: confidence ≤ 0.6, ask for a clarifying detail
- Deeper conversation: higher confidence when warranted, diversify strengths/tips
- Never return the same JSON twice even if the user repeats themselves.`;

// FIXED: Better conversation analysis
function analyzeConversationDepth(messages) {
  const userMessages = messages.filter(m => m.role === 'user');
  const totalLength = userMessages.reduce((sum, m) => sum + m.content.length, 0);
  const avgLength = totalLength / userMessages.length;
  
  return {
    messageCount: userMessages.length,
    totalLength,
    avgLength,
    hasPersonalityRequest: userMessages.some(m => 
      m.content.toLowerCase().includes('mbti') || 
      m.content.toLowerCase().includes('personality') ||
      m.content.toLowerCase().includes('type')
    )
  };
}

// FIXED: Dynamic model parameters based on conversation
function getModelParams(model, conversationDepth) {
  const baseParams = {
    'anthropic/claude-3.5-haiku': { 
      max_tokens: 250, 
      temperature: Math.min(1.1, 0.8 + (conversationDepth.messageCount * 0.1)) // Increase creativity over time
    },
    'google/gemini-flash-1.5-8b': { 
      max_tokens: 200, 
      temperature: Math.min(1.1, 0.7 + (conversationDepth.messageCount * 0.1))
    },
    'meta-llama/llama-3.1-8b-instruct': { 
      max_tokens: 180, 
      temperature: Math.min(1.1, 0.6 + (conversationDepth.messageCount * 0.1)),
      top_p: 0.9 
    },
    'openai/gpt-4o-mini': { 
      max_tokens: 200, 
      temperature: Math.min(1.1, 0.8 + (conversationDepth.messageCount * 0.1))
    }
  };
  
  return baseParams[model] || { max_tokens: 200, temperature: 0.8 };
}

// FIXED: Enhanced JSON response handler
async function getJsonResponse(response) {
  const responseText = await response.text();
  
  console.log('=== API Response Debug ===');
  console.log('Status:', response.status);
  console.log('Response:', responseText.substring(0, 500));
  
  if (!response.ok) {
    console.error('API request failed:', responseText);
    if (response.status === 429) throw new Error('Rate limit exceeded - trying next model');
    if (response.status === 503) throw new Error('Service unavailable - trying next model');
    throw new Error(`API error ${response.status}`);
  }
  
  try {
    // Try parsing as JSON first
    const parsed = JSON.parse(responseText);
    console.log('Successfully parsed JSON response');
    return parsed;
  } catch (e) {
    console.log('Direct JSON parse failed, trying extraction...');
    
    // Try to extract JSON from various formats
    const jsonPatterns = [
      /```json\s*([\s\S]*?)\s*```/i,
      /```\s*([\s\S]*?)\s*```/i,
      /\{[\s\S]*\}/
    ];
    
    for (const pattern of jsonPatterns) {
      const match = responseText.match(pattern);
      if (match) {
        try {
          const extracted = JSON.parse(match[1] || match[0]);
          console.log('Successfully extracted JSON');
          return { choices: [{ message: { content: JSON.stringify(extracted) } }] };
        } catch (e) {
          continue;
        }
      }
    }
    
    throw new Error('Could not extract valid JSON from response');
  }
}

// FIXED: Better conversation summarization for context
function summarizeConversation(messages) {
  const userMessages = messages.filter(m => m.role === 'user');
  const recentMessages = userMessages.slice(-5); // Last 5 user messages
  
  const topics = [];
  const keywords = ['study', 'friend', 'decision', 'feel', 'think', 'prefer', 'like', 'enjoy'];
  
  recentMessages.forEach(msg => {
    keywords.forEach(keyword => {
      if (msg.content.toLowerCase().includes(keyword)) {
        topics.push(keyword);
      }
    });
  });
  
  return {
    topicsCovered: [...new Set(topics)],
    conversationStyle: userMessages.length > 3 ? 'detailed' : 'brief',
    personalityHints: recentMessages.map(m => m.content).join(' ').toLowerCase()
  };
}

async function tryModelsInOrder(messages) {
  const conversationDepth = analyzeConversationDepth(messages);
  const summary = summarizeConversation(messages);
  
  console.log('Conversation analysis:', conversationDepth);
  console.log('Conversation summary:', summary);
  
  let lastError = null;
  
  for (const model of PREFERRED_MODELS) {
    try {
      console.log(`\n=== Trying model: ${model} ===`);
      const params = getModelParams(model, conversationDepth);
      
      // FIXED: Add conversation context to the system prompt
      const contextualSystemPrompt = MBTI_SYSTEM_PROMPT + `\n\nCONVERSATION CONTEXT:
- Messages exchanged: ${conversationDepth.messageCount}
- Topics covered: ${summary.topicsCovered.join(', ')}
- Style: ${summary.conversationStyle}
- Analysis readiness: ${conversationDepth.hasPersonalityRequest ? 'Ready for full analysis' : 'Still gathering info'}

IMPORTANT: This is conversation turn #${conversationDepth.messageCount}. Provide a UNIQUE response that builds on what was already discussed.`;

      const requestBody = {
        model,
        messages: [
          { role: 'system', content: contextualSystemPrompt },
          ...messages
        ],
        ...params,
* 1000000)
      };
      
      console.log('Request body:', JSON.stringify(requestBody, null, 2));
      
      const chatResponse = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: OPENROUTER_HEADERS,
        body: JSON.stringify(requestBody)
      });
      
      const chatJson = await getJsonResponse(chatResponse);
      
      if (!chatJson?.choices?.[0]) {
        console.log(`${model}: invalid response structure`);
        lastError = new Error('Invalid response structure');
        continue;
      }
      
      let content = chatJson.choices[0].message?.content;
      
      if (!content) {
        console.log(`${model}: no content in response`);
        lastError = new Error('No content in response');
        continue;
      }
      
      // Parse and validate the JSON content
      try {
        let parsed;
        if (typeof content === 'string') {
          const cleanContent = content.replace(/```json\s*|\s*```/g, '').trim();
          parsed = JSON.parse(cleanContent);
        } else {
          parsed = content;
        }
        
        // FIXED: Better validation and enrichment
        const result = {
          type: parsed.type || 'Unknown',
          confidence: Math.min(Math.max(parsed.confidence || 0.5, 0.0), 1.0),
          strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 5) : ['Analysis in progress'],
          growth_tips: Array.isArray(parsed.growth_tips) ? parsed.growth_tips.slice(0, 5) : ['Keep sharing more about yourself'],
          one_liner: parsed.one_liner || 'Getting to know your personality'
        };
        
        // Add variety based on conversation depth
        if (conversationDepth.messageCount < 3 && result.type !== 'Unknown') {
          result.confidence = Math.min(result.confidence, 0.6); // Lower confidence early on
          result.growth_tips.unshift("Share more about yourself for better accuracy");
        }
        
        console.log(`✓ Success with ${model}`);
        console.log('Final result:', result);
        return JSON.stringify(result);
        
      } catch (e) {
        console.log(`${model}: JSON validation failed:`, e.message);
        lastError = e;
        continue;
      }
      
    } catch (err) {
      console.log(`${model} failed:`, err.message);
      lastError = err;
      continue;
    }
  }
  
  // Fallback with conversation-aware message
  console.log('All models failed. Providing contextual fallback...');
  const fallback = {
    type: "Unknown",
    confidence: 0.0,
    strengths: conversationDepth.messageCount > 2 
      ? ["You're sharing thoughtfully", "You're engaging in self-reflection"]
      : ["You're curious about self-discovery"],
    growth_tips: conversationDepth.messageCount > 2
      ? ["Try describing a recent decision you made", "Share what energizes you most"]
      : ["Tell me more about how you like to spend your free time"],
    one_liner: conversationDepth.messageCount > 2 
      ? "Building a deeper understanding of your personality"
      : "Just getting started on your personality journey"
  };
  
  return JSON.stringify(fallback);
}

export const handler = async (event) => {
  console.log('\n🚀 Function invoked');
  
  // CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }
  
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('API key not configured');
    }
    
    const body = JSON.parse(event.body || '{}');
    const { messages } = body;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid payload: messages[] required' })
      };
    }
    
    console.log('📝 Processing conversation with', messages.length, 'messages');
    
    const aiResponse = await tryModelsInOrder(messages);
    console.log('✅ AI response generated successfully');
    
    // Optional: Save conversation (non-blocking)
    if (supabase) {
      try {
        const fullConversation = [...messages, { role: 'assistant', content: aiResponse }];
        await supabase.from('conversations').insert({
          conversation_history: fullConversation,
          created_at: new Date().toISOString()
        });
        console.log('✅ Conversation saved');
      } catch (e) {
        console.log('⚠️ Database save failed (non-critical):', e.message);
      }
    }
    
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: aiResponse })
    };
    
  } catch (error) {
    console.error('💥 Error:', error);
    
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Service temporarily unavailable',
        message: error.message
      })
    };
  }
};