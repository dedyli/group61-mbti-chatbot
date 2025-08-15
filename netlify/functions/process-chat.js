// Fixed process-chat.js using CommonJS syntax for Netlify Functions

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS = {
  Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'HTTP-Referer': 'https://group61project.netlify.app/',
  'X-Title': 'Mind-Mapper AI'
};

// Updated models and better parameters
const PREFERRED_MODELS = [
  'anthropic/claude-3.5-haiku',
  'google/gemini-flash-1.5-8b',
  'meta-llama/llama-3.1-8b-instruct',
  'openai/gpt-4o-mini'
];

// Fixed system prompt with better conversation depth requirements
const MBTI_SYSTEM_PROMPT = `You are Mind-Mapper AI, a friendly personality coach.

CRITICAL RULES:
1) Output ONLY valid JSON (no code fences, no extra text)
2) Base content on the conversation so far; DO NOT reuse placeholder values
3) Vary wording and insights across turns; avoid repetition
4) NEVER provide an MBTI type (other than "Unknown") unless you have substantial personality information

CONVERSATION DEPTH REQUIREMENTS:
- Messages 1-3: ALWAYS use type "Unknown", focus on gathering information
- Messages 4-6: Only provide type if user has shared substantial personality details (decision-making style, social preferences, work habits, etc.)
- Messages 7+: Provide type only with high confidence based on rich conversation

OUTPUT SCHEMA:
{
  "type": "<ISTJ|ISFJ|INFJ|INTJ|ISTP|ISFP|INFP|INTP|ESTP|ESFP|ENFP|ENTP|ESTJ|ESFJ|ENFJ|ENTJ|Unknown>",
  "confidence": <float between 0.0 and 1.0>,
  "strengths": ["<short bullet>", "<short bullet>", "<short bullet>"],
  "growth_tips": ["<short bullet>", "<short bullet>", "<short bullet>"],
  "one_liner": "<one-sentence summary>"
}

EARLY CONVERSATION RULES:
- For greetings like "hello", "hi": Use type "Unknown", confidence 0.0, ask about their interests
- For short responses: Use type "Unknown", confidence 0.0-0.2, ask follow-up questions
- For substantial sharing: Can consider providing type, but confidence should remain low (0.3-0.6) until message 7+

NEVER rush to conclusions. Build rapport and gather meaningful information first.`;

// Better conversation analysis with stricter requirements
function analyzeConversationDepth(messages) {
  const userMessages = messages.filter(m => m.role === 'user');
  const totalLength = userMessages.reduce((sum, m) => sum + m.content.length, 0);
  const avgLength = totalLength / userMessages.length;
  
  // Check for personality-relevant content
  const personalityKeywords = [
    'study', 'work', 'decision', 'decide', 'prefer', 'like', 'enjoy', 'friend', 'social', 
    'quiet', 'loud', 'organized', 'spontaneous', 'plan', 'schedule', 'feeling', 'thinking',
    'extrovert', 'introvert', 'team', 'alone', 'group', 'individual', 'creative', 'logical'
  ];
  
  let personalityContentScore = 0;
  userMessages.forEach(msg => {
    const content = msg.content.toLowerCase();
    personalityKeywords.forEach(keyword => {
      if (content.includes(keyword)) personalityContentScore += 1;
    });
  });
  
  // Check if messages are just greetings or very short
  const hasSubstantialContent = userMessages.some(m => 
    m.content.length > 20 && 
    !m.content.toLowerCase().match(/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no)\.?$/i)
  );
  
  return {
    messageCount: userMessages.length,
    totalLength,
    avgLength,
    personalityContentScore,
    hasSubstantialContent,
    hasPersonalityRequest: userMessages.some(m => 
      m.content.toLowerCase().includes('mbti') || 
      m.content.toLowerCase().includes('personality') ||
      m.content.toLowerCase().includes('type') ||
      m.content.toLowerCase().includes('analyze') ||
      m.content.toLowerCase().includes('assessment')
    ),
    isReadyForAnalysis: function() {
      return this.messageCount >= 4 && 
             this.personalityContentScore >= 3 && 
             this.hasSubstantialContent &&
             this.avgLength > 25;
    }
  };
}

// Dynamic model parameters based on conversation
function getModelParams(model, conversationDepth) {
  const baseParams = {
    'anthropic/claude-3.5-haiku': { 
      max_tokens: 250, 
      temperature: Math.min(1.1, 0.8 + (conversationDepth.messageCount * 0.1))
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

// Enhanced JSON response handler
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

// Better conversation summarization for context
function summarizeConversation(messages) {
  const userMessages = messages.filter(m => m.role === 'user');
  const recentMessages = userMessages.slice(-5);
  
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
      
      // Add conversation context to the system prompt with stricter requirements
      const contextualSystemPrompt = MBTI_SYSTEM_PROMPT + `\n\nCONVERSATION CONTEXT:
- Messages exchanged: ${conversationDepth.messageCount}
- Personality content score: ${conversationDepth.personalityContentScore}
- Has substantial content: ${conversationDepth.hasSubstantialContent}
- Ready for analysis: ${conversationDepth.isReadyForAnalysis()}
- Analysis readiness: ${conversationDepth.hasPersonalityRequest ? 'User wants analysis' : 'Still gathering info'}

STRICT REQUIREMENTS FOR THIS TURN #${conversationDepth.messageCount}:
${conversationDepth.messageCount <= 3 ? 
  '- MUST use type "Unknown" - too early for analysis\n- Focus on building rapport and asking about their preferences' :
  conversationDepth.isReadyForAnalysis() ? 
    '- Can provide MBTI type if confident, but keep confidence moderate (0.4-0.7)\n- Ensure analysis is based on substantial personality information shared' :
    '- Use type "Unknown" - need more personality information\n- Ask specific questions about decision-making, social preferences, or work style'
}

IMPORTANT: Provide a UNIQUE response that builds on what was already discussed. Never repeat previous insights.`;

      const requestBody = {
        model,
        messages: [
          { role: 'system', content: contextualSystemPrompt },
          ...messages
        ],
        ...params
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
        
        // Better validation and enrichment with stricter early conversation rules
        const result = {
          type: parsed.type || 'Unknown',
          confidence: Math.min(Math.max(parsed.confidence || 0.0, 0.0), 1.0),
          strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 5) : ['Getting to know you better'],
          growth_tips: Array.isArray(parsed.growth_tips) ? parsed.growth_tips.slice(0, 5) : ['Share more about your preferences'],
          one_liner: parsed.one_liner || 'Building understanding of your personality'
        };
        
        // Enforce stricter early conversation rules
        if (conversationDepth.messageCount <= 3) {
          result.type = 'Unknown';
          result.confidence = 0.0;
          if (!result.growth_tips.some(tip => tip.includes('tell me') || tip.includes('share'))) {
            result.growth_tips.unshift("Tell me more about how you like to spend your time");
          }
        } else if (!conversationDepth.isReadyForAnalysis() && result.type !== 'Unknown') {
          // If AI tried to give a type but we don't have enough info, override it
          result.type = 'Unknown';
          result.confidence = Math.min(result.confidence, 0.3);
          result.growth_tips.unshift("I'd love to learn more about your decision-making style");
        } else if (conversationDepth.isReadyForAnalysis() && result.type !== 'Unknown') {
          // Even when ready for analysis, cap confidence until more conversation
          result.confidence = Math.min(result.confidence, conversationDepth.messageCount >= 7 ? 0.8 : 0.6);
        }
        
        console.log(`✓ Success with ${model}`);
        console.log('Final result:', result);
        console.log('Conversation depth analysis:', conversationDepth);
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
    strengths: conversationDepth.messageCount <= 3 
      ? ["You're taking the first step in self-discovery"]
      : conversationDepth.hasSubstantialContent
        ? ["You're sharing thoughtfully", "You're engaging in self-reflection"]
        : ["You're curious about self-discovery"],
    growth_tips: conversationDepth.messageCount <= 3
      ? ["Tell me about your ideal study environment", "Share how you prefer to make important decisions"]
      : conversationDepth.hasSubstantialContent
        ? ["Describe a recent challenging decision you made", "Tell me what energizes you most in social situations"]
        : ["Share more details about your daily preferences and habits"],
    one_liner: conversationDepth.messageCount <= 3 
      ? "Just getting started on your personality journey"
      : conversationDepth.hasSubstantialContent
        ? "Building a deeper understanding of your personality patterns"
        : "Learning more about your unique personality traits"
  };
  
  return JSON.stringify(fallback);
}

// Using CommonJS exports instead of ES6 export
exports.handler = async (event) => {
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
    
    console.log('🔍 Processing conversation with', messages.length, 'messages');
    
    const aiResponse = await tryModelsInOrder(messages);
    console.log('✅ AI response generated successfully');
    
    // Generate conversation ID for feedback tracking
    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Optional: Save conversation (non-blocking)
    if (supabase) {
      try {
        const fullConversation = [...messages, { role: 'assistant', content: aiResponse }];
        await supabase.from('conversations').insert({
          id: conversationId,
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
      body: JSON.stringify({ 
        reply: aiResponse,
        conversation_id: conversationId
      })
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