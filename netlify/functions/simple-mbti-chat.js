// Simple, reliable ChatGPT-4 MBTI chatbot via OpenRouter

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS = {
  Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'HTTP-Referer': 'https://group61project.netlify.app/',
  'X-Title': 'Mind-Mapper AI'
};

// Use only the most reliable models
const PREFERRED_MODELS = [
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'anthropic/claude-3.5-sonnet'
];

// Simple but effective system prompt
const MBTI_SYSTEM_PROMPT = `You are an expert MBTI personality analyst. Your goal is to determine someone's MBTI type through natural conversation.

CONVERSATION APPROACH:
- Have a friendly, natural conversation (5-8 questions total)
- Ask ONE question at a time
- Focus on these 4 areas: Energy source, Information processing, Decision making, Lifestyle preferences
- Ask follow-up questions if answers are unclear
- Be conversational, not robotic

IMPORTANT RULES:
1. Always respond with ONLY valid JSON (no markdown, no extra text)
2. After 5-8 meaningful exchanges OR when user asks for results, provide MBTI analysis
3. Be warm and encouraging throughout

JSON FORMAT:
{
  "message": "your conversational response or question",
  "type": "MBTI_TYPE or null",
  "confidence": 0.0-1.0,
  "ready": true/false,
  "progress": 1-5
}

EXAMPLES:

First interaction:
{
  "message": "Hi! I'm here to help you discover your MBTI personality type through a quick conversation. Let's start with something simple: After a busy day, what helps you recharge your energy - spending time with friends or having some quiet time alone?",
  "type": null,
  "confidence": 0.0,
  "ready": false,
  "progress": 1
}

Continuing conversation:
{
  "message": "That's interesting! Can you tell me more about how you prefer to learn new things - do you like detailed instructions or do you prefer to explore and figure things out yourself?",
  "type": null,
  "confidence": 0.0,
  "ready": false,
  "progress": 3
}

Final analysis:
{
  "message": "Based on our conversation, you're an INFP - The Mediator! You recharge through alone time, prefer exploring possibilities, make decisions based on values, and like keeping things flexible. You're creative, empathetic, and authentic. Some growth areas might include being more assertive and setting clearer deadlines for yourself.",
  "type": "INFP",
  "confidence": 0.8,
  "ready": true,
  "progress": 5
}

Remember: Always return valid JSON only. Be natural and conversational while gathering the information needed for accurate MBTI assessment.`;

async function callChatGPT(messages) {
  let lastError = null;
  
  // Try each model until one works
  for (const model of PREFERRED_MODELS) {
    try {
      console.log(`Trying model: ${model}`);
      
      const requestBody = {
        model,
        messages: [
          { role: 'system', content: MBTI_SYSTEM_PROMPT },
          ...messages
        ],
        max_tokens: 300,
        temperature: 0.7
      };
      
      const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: OPENROUTER_HEADERS,
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      
      if (!data.choices?.[0]?.message?.content) {
        throw new Error('Invalid response structure');
      }
      
      let content = data.choices[0].message.content.trim();
      
      // Clean up any markdown formatting
      content = content.replace(/```json\s*|\s*```/g, '').trim();
      
      // Parse JSON
      const parsed = JSON.parse(content);
      
      // Validate required fields
      if (!parsed.message) {
        throw new Error('Missing message field');
      }
      
      console.log(`✅ Success with ${model}`);
      return parsed;
      
    } catch (error) {
      console.log(`❌ ${model} failed:`, error.message);
      lastError = error;
      continue;
    }
  }
  
  // If all models fail, return a fallback
  console.log('All models failed, using fallback');
  return {
    message: "I'm having some technical difficulties. Let me ask you a simple question to get started: What gives you more energy - being around people or having quiet time alone?",
    type: null,
    confidence: 0.0,
    ready: false,
    progress: 1
  };
}

exports.handler = async (event) => {
  console.log('🚀 MBTI Chatbot function invoked');
  
  // CORS headers
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
    // Check API key
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('OpenRouter API key not configured');
    }
    
    // Parse request
    const body = JSON.parse(event.body || '{}');
    const { messages } = body;
    
    if (!Array.isArray(messages)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Messages array required' })
      };
    }
    
    console.log(`Processing ${messages.length} messages`);
    
    // Call ChatGPT
    const result = await callChatGPT(messages);
    
    console.log('✅ Response generated successfully');
    
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
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