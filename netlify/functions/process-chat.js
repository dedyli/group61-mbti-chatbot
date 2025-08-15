// Simplified but reliable process-chat.js

const { createClient } = require('@supabase/supabase-js');

// Check environment variables
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

const PREFERRED_MODELS = [
  'anthropic/claude-3.5-haiku',
  'google/gemini-flash-1.5-8b',
  'meta-llama/llama-3.1-8b-instruct',
  'openai/gpt-4o-mini'
];

// Streamlined system prompt focused on getting results
const MBTI_SYSTEM_PROMPT = `You are Mind-Mapper AI, a conversational MBTI personality analyst.

CRITICAL RULES:
1) Output ONLY valid JSON (no code fences, no extra text)
2) Ask meaningful questions to understand personality preferences
3) After 4-5 exchanges OR when user asks for results, provide MBTI analysis
4) Be conversational and encouraging

CORE DIMENSIONS TO EXPLORE:
1. Energy source: People (Extraversion) vs Solitude (Introversion)
2. Information processing: Details/Facts (Sensing) vs Patterns/Possibilities (Intuition)  
3. Decision making: Logic/Analysis (Thinking) vs Values/Feelings (Feeling)
4. Lifestyle: Structure/Planning (Judging) vs Flexibility/Spontaneity (Perceiving)

CONVERSATION STRATEGY:
- Ask ONE clear question at a time about preferences
- Use examples to make questions easier to answer
- If user gives vague answer, gently ask for clarification
- After 4+ meaningful exchanges, be ready to provide analysis
- If user explicitly asks for results, provide them

QUESTION EXAMPLES:
- "After a busy day, what helps you recharge: spending time with friends or having quiet time alone?"
- "When learning something new, do you prefer step-by-step instructions or exploring the big picture first?"
- "In decision-making, do you rely more on logical analysis or on how it affects people's feelings?"
- "Do you prefer having a planned schedule or keeping things flexible and spontaneous?"

OUTPUT SCHEMA:
{
  "type": "<MBTI_TYPE|Unknown>",
  "confidence": <float 0.0-1.0>,
  "strengths": ["<strength>", "<strength>", "<strength>"],
  "growth_tips": ["<tip>", "<tip>", "<tip>"],
  "one_liner": "<question_or_personality_summary>",
  "ready_for_analysis": <boolean>
}

ANALYSIS TRIGGERS:
- User has answered 4+ questions with specific preferences
- User explicitly asks for their type/results ("what's my type", "give me results", etc.)
- Conversation has covered multiple personality dimensions
- User seems ready for analysis based on engagement

When providing analysis:
- Set ready_for_analysis: true
- Choose most likely MBTI type based on conversation
- Set confidence between 0.6-0.8 (be realistic)
- Provide 3-4 relevant strengths
- Give 3-4 practical growth tips
- Include encouraging one-liner summary

When asking questions:
- Set ready_for_analysis: false
- Set type: "Unknown"
- Set confidence: 0.0
- Use one_liner for the next question
- Keep strengths/tips encouraging but general`;

// Smart conversation analysis with context awareness
function analyzeConversation(messages) {
  const userMessages = messages.filter(m => m.role === 'user');
  const conversation = messages.map(m => m.content.toLowerCase()).join(' ');
  
  // Check for explicit requests for results
  const resultRequests = [
    'what\'s my type', 'give me my mbti', 'what am i', 'my personality', 
    'what type am i', 'give me results', 'my result', 'assessment result',
    'what\'s my personality', 'tell me my type', 'so what\'s my mbti',
    'what\'s my mbti', 'my mbti', 'give me analysis', 'analyze me',
    'what do you think', 'tell me', 'result', 'assessment', 'type'
  ];
  
  const hasResultRequest = resultRequests.some(phrase => 
    conversation.includes(phrase.toLowerCase())
  );
  
  // Check if this is the very first message asking for results
  const firstMessageIsResultRequest = userMessages.length === 1 && hasResultRequest;
  
  // Check if we have enough content for analysis
  const totalLength = userMessages.reduce((sum, msg) => sum + msg.content.length, 0);
  const hasSubstantialContent = totalLength > 50;
  
  // Check for personality-related keywords that show actual sharing
  const personalityKeywords = [
    'prefer', 'like', 'enjoy', 'feel', 'think', 'decide', 'choose',
    'friends', 'alone', 'quiet', 'social', 'plan', 'flexible', 
    'logical', 'emotional', 'details', 'big picture', 'creative',
    'practical', 'recharge', 'energy', 'usually', 'tend to',
    'comfortable', 'naturally', 'often', 'most of the time'
  ];
  
  const keywordCount = personalityKeywords.filter(keyword => 
    conversation.includes(keyword)
  ).length;
  
  // Check for actual personality sharing vs just asking
  const hasPersonalitySharing = keywordCount >= 2 && hasSubstantialContent;
  
  return {
    messageCount: userMessages.length,
    hasResultRequest,
    hasSubstantialContent,
    keywordCount,
    totalLength,
    firstMessageIsResultRequest,
    hasPersonalitySharing,
    shouldProvideAnalysis: function() {
      // Don't give results on first message even if they ask
      if (this.firstMessageIsResultRequest) {
        return false;
      }
      
      // Smart conditions - need both request AND actual conversation
      return (
        (this.hasResultRequest && this.hasPersonalitySharing) || // Asked + shared info
        (this.messageCount >= 4 && this.keywordCount >= 3) || // Enough conversation 
        (this.messageCount >= 3 && this.hasResultRequest && this.keywordCount >= 1) // Asked after some sharing
      );
    },
    shouldExplainProcess: function() {
      // Explain process if they ask for results too early
      return this.firstMessageIsResultRequest || 
             (this.hasResultRequest && !this.hasPersonalitySharing && this.messageCount <= 2);
    }
  };
}

// Get appropriate question based on conversation stage
function getNextQuestion(messageCount, conversation) {
  const lowerConv = conversation.toLowerCase();
  
  // Energy source (E/I)
  if (messageCount <= 2 && !lowerConv.includes('recharge') && !lowerConv.includes('energy')) {
    return "After a busy day at school or work, what helps you recharge your energy: spending time with friends and family, or having some quiet time alone?";
  }
  
  // Information processing (S/N)
  if (messageCount <= 3 && !lowerConv.includes('learn') && !lowerConv.includes('instruction')) {
    return "When learning something new (like a new app or skill), do you prefer detailed step-by-step instructions, or do you like to explore and figure out the big picture yourself?";
  }
  
  // Decision making (T/F)
  if (messageCount <= 4 && !lowerConv.includes('decision') && !lowerConv.includes('choose')) {
    return "When making important decisions, what do you rely on more: logical analysis of pros and cons, or considering how it will affect people and relationships?";
  }
  
  // Lifestyle (J/P)
  if (messageCount <= 5 && !lowerConv.includes('plan') && !lowerConv.includes('schedule')) {
    return "Do you prefer having a clear plan and schedule for your day, or do you like to keep things flexible and adapt as you go?";
  }
  
  // Ready for analysis prompts
  return "I'm getting a good sense of your preferences! Would you like me to analyze your personality type, or is there anything else you'd like to share about how you approach life?";
}

// Simplified MBTI type inference
function inferMBTIType(conversation) {
  const conv = conversation.toLowerCase();
  
  // E vs I
  const extraversionWords = ['friends', 'people', 'social', 'group', 'team', 'others', 'collaborate'];
  const introversionWords = ['alone', 'quiet', 'myself', 'independent', 'solitude', 'private'];
  const eScore = extraversionWords.filter(w => conv.includes(w)).length;
  const iScore = introversionWords.filter(w => conv.includes(w)).length;
  const EI = iScore > eScore ? 'I' : 'E';
  
  // S vs N
  const sensingWords = ['details', 'step-by-step', 'specific', 'practical', 'concrete', 'facts', 'instructions'];
  const intuitionWords = ['big picture', 'creative', 'possibilities', 'innovative', 'abstract', 'future', 'patterns'];
  const sScore = sensingWords.filter(w => conv.includes(w)).length;
  const nScore = intuitionWords.filter(w => conv.includes(w)).length;
  const SN = nScore > sScore ? 'N' : 'S';
  
  // T vs F
  const thinkingWords = ['logical', 'analysis', 'rational', 'objective', 'facts', 'pros and cons', 'efficient'];
  const feelingWords = ['feelings', 'people', 'values', 'harmony', 'emotions', 'relationships', 'impact'];
  const tScore = thinkingWords.filter(w => conv.includes(w)).length;
  const fScore = feelingWords.filter(w => conv.includes(w)).length;
  const TF = fScore > tScore ? 'F' : 'T';
  
  // J vs P
  const judgingWords = ['plan', 'schedule', 'organized', 'structure', 'deadline', 'routine', 'early'];
  const perceivingWords = ['flexible', 'spontaneous', 'adapt', 'open', 'last minute', 'improvise'];
  const jScore = judgingWords.filter(w => conv.includes(w)).length;
  const pScore = perceivingWords.filter(w => conv.includes(w)).length;
  const JP = pScore > jScore ? 'P' : 'J';
  
  return EI + SN + TF + JP;
}

// Get strengths and tips for MBTI type
function getTypeInsights(type) {
  const insights = {
    'INTJ': {
      strengths: ['Strategic thinking and long-term planning', 'Independent and self-motivated', 'Strong analytical abilities'],
      tips: ['Practice explaining ideas to others simply', 'Make time for social connections', 'Be open to feedback and alternative approaches']
    },
    'INTP': {
      strengths: ['Logical analysis and problem-solving', 'Creative and innovative thinking', 'Adaptable and open-minded'],
      tips: ['Set deadlines to complete projects', 'Practice communicating ideas clearly', 'Focus on practical applications of your ideas']
    },
    'ENTJ': {
      strengths: ['Natural leadership and organization', 'Strategic planning abilities', 'Confident decision-making'],
      tips: ['Listen to others\' perspectives more', 'Show appreciation for team contributions', 'Balance work with personal relationships']
    },
    'ENTP': {
      strengths: ['Creative problem-solving', 'Enthusiasm and energy', 'Ability to see connections and possibilities'],
      tips: ['Follow through on commitments', 'Create structured plans for goals', 'Practice active listening in conversations']
    },
    'INFJ': {
      strengths: ['Deep empathy and understanding', 'Visionary thinking', 'Strong personal values'],
      tips: ['Set boundaries to avoid burnout', 'Express your needs more directly', 'Take time for practical, hands-on activities']
    },
    'INFP': {
      strengths: ['Authentic and values-driven', 'Creative and imaginative', 'Supportive of others\' growth'],
      tips: ['Practice asserting yourself in groups', 'Set structured goals with deadlines', 'Share your ideas more confidently']
    },
    'ENFJ': {
      strengths: ['Inspiring and motivating others', 'Strong communication skills', 'Organized and goal-oriented'],
      tips: ['Take time for self-care', 'Accept that you can\'t help everyone', 'Practice receiving feedback gracefully']
    },
    'ENFP': {
      strengths: ['Enthusiastic and inspiring', 'Great at building relationships', 'Adaptable and spontaneous'],
      tips: ['Create routines and stick to them', 'Focus on completing projects', 'Practice patience with detailed tasks']
    },
    'ISTJ': {
      strengths: ['Reliable and responsible', 'Excellent attention to detail', 'Strong work ethic'],
      tips: ['Be open to new approaches', 'Express appreciation for others more', 'Try brainstorming creative solutions']
    },
    'ISFJ': {
      strengths: ['Caring and supportive', 'Detail-oriented and thorough', 'Loyal and dependable'],
      tips: ['Practice saying no when needed', 'Share your accomplishments more', 'Try new experiences outside your comfort zone']
    },
    'ESTJ': {
      strengths: ['Organized and efficient', 'Natural leadership abilities', 'Goal-oriented and decisive'],
      tips: ['Listen to different perspectives', 'Show flexibility when plans change', 'Acknowledge others\' contributions more']
    },
    'ESFJ': {
      strengths: ['Great at supporting others', 'Strong interpersonal skills', 'Organized and dependable'],
      tips: ['Take time for your own needs', 'Practice handling conflict directly', 'Trust your own judgment more']
    },
    'ISTP': {
      strengths: ['Practical problem-solving', 'Calm under pressure', 'Hands-on learning approach'],
      tips: ['Practice expressing emotions', 'Plan ahead for important goals', 'Engage more in group discussions']
    },
    'ISFP': {
      strengths: ['Authentic and genuine', 'Sensitive to others\' needs', 'Adaptable and flexible'],
      tips: ['Speak up for your ideas', 'Set clearer boundaries', 'Practice planning and organization']
    },
    'ESTP': {
      strengths: ['Energetic and action-oriented', 'Great at reading people', 'Adaptable and resourceful'],
      tips: ['Think before acting in important situations', 'Create long-term goals', 'Practice patience with theoretical concepts']
    },
    'ESFP': {
      strengths: ['Enthusiastic and fun-loving', 'Great at encouraging others', 'Spontaneous and flexible'],
      tips: ['Practice planning ahead', 'Focus on completing tasks', 'Take time for quiet reflection']
    }
  };
  
  return insights[type] || {
    strengths: ['Self-aware and growth-oriented', 'Open to new experiences', 'Thoughtful in approach'],
    tips: ['Continue exploring your preferences', 'Practice self-reflection', 'Stay open to personal growth']
  };
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
    const parsed = JSON.parse(responseText);
    console.log('Successfully parsed JSON response');
    return parsed;
  } catch (e) {
    console.log('Direct JSON parse failed, trying extraction...');
    
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

async function tryModelsInOrder(messages) {
  const conversationAnalysis = analyzeConversation(messages);
  const fullConversation = messages.map(m => m.content).join(' ');
  
  console.log('Conversation analysis:', {
    messageCount: conversationAnalysis.messageCount,
    shouldProvideAnalysis: conversationAnalysis.shouldProvideAnalysis(),
    hasResultRequest: conversationAnalysis.hasResultRequest,
    hasSubstantialContent: conversationAnalysis.hasSubstantialContent,
    keywordCount: conversationAnalysis.keywordCount
  });
  
  let lastError = null;
  
  for (const model of PREFERRED_MODELS) {
    try {
      console.log(`\n=== Trying model: ${model} ===`);
      
      // Build context for the AI
      const contextualPrompt = MBTI_SYSTEM_PROMPT + `\n\nCONVERSATION CONTEXT:
- Message count: ${conversationAnalysis.messageCount}
- Should provide analysis: ${conversationAnalysis.shouldProvideAnalysis()}
- Should explain process: ${conversationAnalysis.shouldExplainProcess()}
- User requested results: ${conversationAnalysis.hasResultRequest}
- Has personality sharing: ${conversationAnalysis.hasPersonalitySharing}
- First message is result request: ${conversationAnalysis.firstMessageIsResultRequest}

INSTRUCTION:
${conversationAnalysis.shouldExplainProcess() ? 
  'The user asked for results too early. Politely explain that you need to learn about their preferences first through conversation. Ask an engaging personality question. Set ready_for_analysis: false.' :
  conversationAnalysis.shouldProvideAnalysis() ? 
    'The user is ready for MBTI analysis. Provide a complete personality assessment with type, confidence 0.7-0.8, strengths, and growth tips. Set ready_for_analysis: true.' :
    'Continue the conversation with a thoughtful question about personality preferences. Set ready_for_analysis: false, type: "Unknown", confidence: 0.0.'
}`;

      const requestBody = {
        model,
        messages: [
          { role: 'system', content: contextualPrompt },
          ...messages
        ],
        max_tokens: 400,
        temperature: 0.7
      };
      
      const chatResponse = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: OPENROUTER_HEADERS,
        body: JSON.stringify(requestBody)
      });
      
      const chatJson = await getJsonResponse(chatResponse);
      
      if (!chatJson?.choices?.[0]) {
        lastError = new Error('Invalid response structure');
        continue;
      }
      
      let content = chatJson.choices[0].message?.content;
      
      if (!content) {
        lastError = new Error('No content in response');
        continue;
      }
      
      // Parse and build result
      try {
        let parsed;
        if (typeof content === 'string') {
          const cleanContent = content.replace(/```json\s*|\s*```/g, '').trim();
          parsed = JSON.parse(cleanContent);
        } else {
          parsed = content;
        }
        
        // Build final result
        let result;
        
        if (conversationAnalysis.shouldExplainProcess()) {
          // Explain that we need conversation first
          result = {
            type: 'Unknown',
            confidence: 0.0,
            strengths: ['Curious about self-discovery', 'Taking initiative in personal growth'],
            growth_tips: ['Share your authentic preferences', 'Think about what feels most natural to you'],
            one_liner: "I'd love to help you discover your MBTI type! But first, I need to learn about your personality through conversation. " + 
                      getNextQuestion(1, fullConversation),
            ready_for_analysis: false
          };
        } else if (conversationAnalysis.shouldProvideAnalysis()) {
          // ALWAYS force analysis if conditions are met - no relying on AI decision
          const inferredType = inferMBTIType(fullConversation);
          const insights = getTypeInsights(inferredType);
          
          result = {
            type: inferredType, // Always use inferred type
            confidence: 0.75, // Fixed confidence
            strengths: insights.strengths,
            growth_tips: insights.tips,
            one_liner: `You show strong ${inferredType} characteristics in your approach to life and decision-making.`,
            ready_for_analysis: true
          };
          
          console.log('FORCING ANALYSIS with inferred type:', inferredType);
        } else {
          // Continue questioning
          result = {
            type: 'Unknown',
            confidence: 0.0,
            strengths: ['Engaging in meaningful self-reflection', 'Open to exploring your personality'],
            growth_tips: ['Continue sharing your authentic preferences', 'Think about what feels most natural to you'],
            one_liner: parsed.one_liner || getNextQuestion(conversationAnalysis.messageCount, fullConversation),
            ready_for_analysis: false
          };
        }
        
        console.log(`✅ Success with ${model}`);
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
  
  // Reliable fallback
  console.log('All models failed. Providing reliable fallback...');
  
  if (conversationAnalysis.shouldExplainProcess()) {
    return JSON.stringify({
      type: "Unknown",
      confidence: 0.0,
      strengths: ["Eager to learn about yourself", "Taking steps toward self-awareness"],
      growth_tips: ["Share your natural preferences honestly", "Think about what energizes you"],
      one_liner: "I'd love to help discover your personality type! First, let me ask: " + 
                getNextQuestion(1, fullConversation),
      ready_for_analysis: false
    });
  }
  
  if (conversationAnalysis.shouldProvideAnalysis()) {
    const inferredType = inferMBTIType(fullConversation);
    const insights = getTypeInsights(inferredType);
    
    return JSON.stringify({
      type: inferredType,
      confidence: 0.65,
      strengths: insights.strengths,
      growth_tips: insights.tips,
      one_liner: `Based on our conversation, you show ${inferredType} characteristics.`,
      ready_for_analysis: true
    });
  } else {
    return JSON.stringify({
      type: "Unknown",
      confidence: 0.0,
      strengths: ["You're taking time for self-discovery", "You're engaging thoughtfully"],
      growth_tips: ["Keep sharing your authentic preferences", "Think about what feels most natural"],
      one_liner: getNextQuestion(conversationAnalysis.messageCount, fullConversation),
      ready_for_analysis: false
    });
  }
}

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
    
    const conversationId = Date.now();
    let actualConversationId = conversationId;
    
    console.log('🔍 Processing conversation with', messages.length, 'messages');
    
    const aiResponse = await tryModelsInOrder(messages);
    console.log('✅ AI response generated successfully');
    
    // Save conversation
    if (supabase) {
      try {
        const fullConversation = [...messages, { role: 'assistant', content: aiResponse }];
        
        const { data, error } = await supabase.from('conversations').insert({
          conversation_history: fullConversation,
          created_at: new Date().toISOString()
        }).select('id');
        
        if (error) {
          console.error('❌ Supabase insert error:', error);
        } else if (data && data[0] && data[0].id) {
          actualConversationId = data[0].id;
          console.log('✅ Conversation saved successfully with ID:', actualConversationId);
        }
      } catch (e) {
        console.error('💥 Database save failed:', e.message);
      }
    }
    
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        reply: aiResponse,
        conversation_id: actualConversationId
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