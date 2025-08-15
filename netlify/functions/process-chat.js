// Fixed process-chat.js using CommonJS syntax for Netlify Functions

const { createClient } = require('@supabase/supabase-js');

// Fix: Check environment variables first
console.log('Environment check:');
console.log('SUPABASE_URL present:', !!process.env.SUPABASE_URL);
console.log('SUPABASE_SERVICE_KEY present:', !!process.env.SUPABASE_SERVICE_KEY);

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  try {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    console.log('✅ Backend Supabase client created successfully');
  } catch (error) {
    console.error('❌ Failed to create backend Supabase client:', error);
  }
} else {
  console.error('❌ Missing Supabase environment variables');
}

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

// Fixed system prompt with specific questions and faster analysis
const MBTI_SYSTEM_PROMPT = `You are Mind-Mapper AI, a friendly personality coach.

CRITICAL RULES:
1) Output ONLY valid JSON (no code fences, no extra text)
2) Ask ONE specific, direct question that's easy to answer
3) Provide MBTI analysis after 3-4 meaningful exchanges
4) Base analysis on the conversation patterns you observe

CONVERSATION FLOW:
- Message 1 (greeting): Ask about study/work preferences (quiet vs busy environment)
- Message 2: Ask about decision-making (logical analysis vs gut feeling)  
- Message 3: Ask about social energy (energized by people vs energized by alone time)
- Message 4+: Provide MBTI type with confidence based on their answers

QUESTION EXAMPLES:
- "When studying or working, do you prefer a quiet, organized space or do you work well with background noise and activity?"
- "When making important decisions, do you usually analyze all the facts first, or do you tend to go with your gut feeling?"
- "After a long day, do you feel more energized hanging out with friends or having some quiet time alone?"
- "Do you prefer having a clear plan and schedule, or do you like keeping things flexible and spontaneous?"

OUTPUT SCHEMA:
{
  "type": "<ISTJ|ISFJ|INFJ|INTJ|ISTP|ISFP|INFP|INTP|ESTP|ESFP|ENFP|ENTP|ESTJ|ESFJ|ENFJ|ENTJ|Unknown>",
  "confidence": <float between 0.0 and 1.0>,
  "strengths": ["<short bullet>", "<short bullet>", "<short bullet>"],
  "growth_tips": ["<short bullet>", "<short bullet>", "<short bullet>"],
  "one_liner": "<one-sentence summary or specific question>"
}

ANALYSIS RULES:
- Messages 1-2: Use type "Unknown", ask specific questions in one_liner
- Message 3: Can start forming hypothesis, but still ask one more question
- Message 4+: Provide confident MBTI analysis based on their responses

Make questions conversational and easy to answer with specific examples.`;

// Simplified conversation analysis focused on question flow
function analyzeConversationDepth(messages) {
  const userMessages = messages.filter(m => m.role === 'user');
  const totalLength = userMessages.reduce((sum, m) => sum + m.content.length, 0);
  
  // Track what aspects have been covered - make this more strict
  const aspects = {
    workEnvironment: false,
    decisionMaking: false,
    socialEnergy: false,
    planningStyle: false
  };
  
  const allContent = messages.map(m => m.content.toLowerCase()).join(' ');
  
  // More strict keyword matching - require specific terms
  if (allContent.includes('quiet') && allContent.includes('organized') || 
      allContent.includes('noise') && allContent.includes('activity') ||
      allContent.includes('study') && (allContent.includes('space') || allContent.includes('environment'))) {
    aspects.workEnvironment = true;
  }
  if ((allContent.includes('decision') || allContent.includes('decide')) && 
      (allContent.includes('analyze') || allContent.includes('gut') || allContent.includes('facts'))) {
    aspects.decisionMaking = true;
  }
  if ((allContent.includes('friends') || allContent.includes('social')) && 
      (allContent.includes('alone') || allContent.includes('energized'))) {
    aspects.socialEnergy = true;
  }
  if ((allContent.includes('plan') || allContent.includes('schedule')) && 
      (allContent.includes('flexible') || allContent.includes('spontaneous'))) {
    aspects.planningStyle = true;
  }
  
  const aspectsCovered = Object.values(aspects).filter(Boolean).length;
  
  return {
    messageCount: userMessages.length,
    totalLength,
    aspectsCovered,
    aspects,
    isReadyForAnalysis: function() {
      return this.messageCount >= 3 && aspectsCovered >= 2;
    },
    shouldGiveFullAnalysis: function() {
      return this.messageCount >= 4 || aspectsCovered >= 3;
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
      
      // Add conversation context with question flow guidance
      const contextualSystemPrompt = MBTI_SYSTEM_PROMPT + `\n\nCONVERSATION CONTEXT:
- Message number: ${conversationDepth.messageCount}
- Aspects covered: ${conversationDepth.aspectsCovered}/4
- Work environment discussed: ${conversationDepth.aspects.workEnvironment}
- Decision-making discussed: ${conversationDepth.aspects.decisionMaking}
- Social energy discussed: ${conversationDepth.aspects.socialEnergy}
- Planning style discussed: ${conversationDepth.aspects.planningStyle}

INSTRUCTIONS FOR MESSAGE #${conversationDepth.messageCount}:
${conversationDepth.messageCount === 1 ? 
  'Ask about work/study environment preferences (quiet vs busy, organized vs flexible)' :
  conversationDepth.messageCount === 2 ? 
    'Ask about decision-making style (logical analysis vs intuition/gut feeling)' :
    conversationDepth.messageCount === 3 ?
      'Ask about social energy (energized by people vs alone time)' :
      conversationDepth.shouldGiveFullAnalysis() ?
        'Provide MBTI analysis with confidence 0.6-0.8 based on their responses' :
        'Ask one final question about planning (structured vs spontaneous) then analyze'
}

REMEMBER: Keep questions specific and easy to answer. Use the one_liner field for questions when type is "Unknown".`;

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
        
        // Streamlined validation for question-based flow
        const result = {
          type: parsed.type || 'Unknown',
          confidence: Math.min(Math.max(parsed.confidence || 0.0, 0.0), 1.0),
          strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 5) : ['Learning about your preferences'],
          growth_tips: Array.isArray(parsed.growth_tips) ? parsed.growth_tips.slice(0, 5) : ['Continue sharing your thoughts'],
          one_liner: parsed.one_liner || 'Getting to know your personality style'
        };
        
        // Enforce question flow rules
        if (conversationDepth.messageCount <= 2) {
          result.type = 'Unknown';
          result.confidence = 0.0;
        } else if (conversationDepth.messageCount === 3 && !conversationDepth.shouldGiveFullAnalysis()) {
          result.type = 'Unknown';
          result.confidence = Math.min(result.confidence, 0.3);
        } else if (conversationDepth.shouldGiveFullAnalysis() && result.type !== 'Unknown') {
          // Good to provide analysis
          result.confidence = Math.min(Math.max(result.confidence, 0.6), 0.8);
        }
        
        console.log(`✓ Success with ${model}`);
        console.log('Final result:', result);
        console.log('Conversation analysis:', conversationDepth);
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
  
  // Improved fallback with specific questions
  console.log('All models failed. Providing contextual fallback...');
  
  const getQuestionForMessage = (messageNum) => {
    switch(messageNum) {
      case 1: return "When studying or working, do you prefer a quiet, organized space or do you work well with background noise and activity?";
      case 2: return "When making important decisions, do you usually analyze all the facts first, or do you tend to go with your gut feeling?";
      case 3: return "After a long day, do you feel more energized hanging out with friends or having some quiet time alone?";
      default: return "Do you prefer having a clear plan and schedule, or do you like keeping things flexible and spontaneous?";
    }
  };
  
  const fallback = {
    type: "Unknown",
    confidence: 0.0,
    strengths: conversationDepth.messageCount <= 2 
      ? ["You're open to self-discovery", "You're taking time for self-reflection"]
      : ["You're sharing thoughtfully", "You're engaging authentically"],
    growth_tips: conversationDepth.messageCount <= 2
      ? ["Answer honestly about your preferences", "Think about what feels most natural to you"]
      : ["Keep sharing your authentic preferences", "There are no right or wrong answers"],
    one_liner: conversationDepth.shouldGiveFullAnalysis() 
      ? "Ready to analyze your personality based on our conversation!"
      : getQuestionForMessage(conversationDepth.messageCount)
  };
  
  return JSON.stringify(fallback);
}

exports.handler = async (event) => {
  console.log('\n🚀 Function invoked');
  console.log('Environment check:');
  console.log('SUPABASE_URL present:', !!process.env.SUPABASE_URL);
  console.log('SUPABASE_SERVICE_KEY present:', !!process.env.SUPABASE_SERVICE_KEY);
  console.log('OPENROUTER_API_KEY present:', !!process.env.OPENROUTER_API_KEY);
  
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
    
    // Generate simple timestamp-based ID
    const conversationId = Date.now();
    let actualConversationId = conversationId; // This will be updated after saving
    
    console.log('🔍 Processing conversation with', messages.length, 'messages');
    
    const aiResponse = await tryModelsInOrder(messages);
    console.log('✅ AI response generated successfully');
    
    // Save conversation and get the actual database ID
    if (supabase) {
      try {
        const fullConversation = [...messages, { role: 'assistant', content: aiResponse }];
        
        console.log('📁 Attempting to save conversation to Supabase...');
        console.log('📊 Conversation length:', fullConversation.length);
        console.log('🔗 Supabase URL:', process.env.SUPABASE_URL);
        
        const { data, error } = await supabase.from('conversations').insert({
          conversation_history: fullConversation,
          created_at: new Date().toISOString()
        }).select('id'); // Get the ID back
        
        if (error) {
          console.error('❌ Supabase insert error:', error);
          console.error('Error details:', JSON.stringify(error, null, 2));
          throw error;
        }
        
        if (data && data[0] && data[0].id) {
          actualConversationId = data[0].id;
          console.log('✅ Conversation saved successfully with ID:', actualConversationId);
        } else {
          console.log('⚠️ Conversation saved but no ID returned. Data:', JSON.stringify(data, null, 2));
        }
      } catch (e) {
        console.error('💥 Database save failed:', e.message);
        console.error('Full error details:', JSON.stringify(e, null, 2));
        // Don't fail the whole request if database save fails
      }
    } else {
      console.log('⚠️ Supabase client not initialized - skipping conversation save');
    }
    
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        reply: aiResponse,
        conversation_id: actualConversationId // Use the actual database ID
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