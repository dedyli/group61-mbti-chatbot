// Enhanced process-chat.js with answer validation and adaptive questioning

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

// Enhanced system prompt with validation logic
const MBTI_SYSTEM_PROMPT = `You are Mind-Mapper AI, a conversational personality analyst who needs CLEAR, RELEVANT answers before providing MBTI analysis.

CRITICAL RULES:
1) Output ONLY valid JSON (no code fences, no extra text)
2) VALIDATE user answers - only accept relevant, specific responses
3) Ask follow-up questions if answers are vague, off-topic, or insufficient
4) Only provide MBTI analysis when you have SOLID information on all 4 dimensions
5) Be friendly but persistent in getting meaningful answers

REQUIRED DIMENSIONS TO ASSESS:
1. EXTRAVERSION vs INTROVERSION: Energy source (people vs solitude)
2. SENSING vs INTUITION: Information processing (details/facts vs patterns/possibilities)
3. THINKING vs FEELING: Decision making (logic/analysis vs values/emotions)
4. JUDGING vs PERCEIVING: Lifestyle preference (structure/planning vs flexibility/spontaneity)

ANSWER VALIDATION CRITERIA:
- GOOD answers: Specific preferences, examples, clear choices between options
- BAD answers: Vague ("it depends"), non-answers ("I don't know"), off-topic responses

CONVERSATION FLOW:
- Ask ONE specific question at a time
- Validate the user's answer before moving to next dimension
- If answer is unclear/irrelevant, rephrase the question with examples
- Only move forward when you have a clear, usable answer
- Provide MBTI analysis ONLY when all 4 dimensions are adequately covered

QUESTION EXAMPLES BY DIMENSION:

EXTRAVERSION/INTROVERSION:
- "After a busy day, what helps you recharge: being around friends and family, or having quiet time alone?"
- "When working on projects, do you prefer collaborating with others or working independently?"

SENSING/INTUITION:
- "When learning something new, do you prefer step-by-step instructions with examples, or do you like to see the big picture first and figure out the details?"
- "Are you more drawn to practical, proven methods or innovative, creative approaches?"

THINKING/FEELING:
- "When making important decisions, what weighs more heavily: logical analysis of pros/cons, or how the decision will affect people's feelings?"
- "When giving feedback, do you focus on being direct and honest, or on being tactful and considerate?"

JUDGING/PERCEIVING:
- "Do you prefer having a clear schedule and plan for your day, or do you like keeping things flexible and spontaneous?"
- "When working on assignments, do you start early and work steadily, or do you work better under pressure closer to deadlines?"

OUTPUT SCHEMA:
{
  "type": "<MBTI_TYPE|Unknown>",
  "confidence": <float 0.0-1.0>,
  "strengths": ["<strength>", "<strength>", "<strength>"],
  "growth_tips": ["<tip>", "<tip>", "<tip>"],
  "one_liner": "<question_or_summary>",
  "validation_status": "<need_more_info|ready_for_analysis|clarification_needed>",
  "missing_dimensions": ["<dimension_if_missing>"]
}

VALIDATION LOGIC:
- If user gives vague/irrelevant answer: validation_status = "clarification_needed", rephrase question
- If missing information on dimensions: validation_status = "need_more_info", ask about missing dimension
- If all dimensions covered with good answers: validation_status = "ready_for_analysis", provide MBTI type

Remember: Be conversational but ensure you get REAL, SPECIFIC answers before moving forward.`;

// Enhanced conversation analysis with answer validation
function analyzeConversationDepth(messages) {
  const userMessages = messages.filter(m => m.role === 'user');
  const aiMessages = messages.filter(m => m.role === 'assistant');
  
  // Track dimensions and answer quality
  const dimensions = {
    extraversion_introversion: { covered: false, quality: 'none', keywords: [] },
    sensing_intuition: { covered: false, quality: 'none', keywords: [] },
    thinking_feeling: { covered: false, quality: 'none', keywords: [] },
    judging_perceiving: { covered: false, quality: 'none', keywords: [] }
  };
  
  const allContent = messages.map(m => m.content.toLowerCase()).join(' ');
  
  // Enhanced keyword analysis for each dimension
  // Extraversion/Introversion indicators
  const extraversionKeywords = ['friends', 'people', 'social', 'party', 'group', 'team', 'collaborate', 'together'];
  const introversionKeywords = ['alone', 'quiet', 'solitude', 'independent', 'recharge', 'private', 'myself'];
  
  if (hasRelevantAnswer(allContent, [...extraversionKeywords, ...introversionKeywords], ['energy', 'recharge', 'people', 'alone'])) {
    dimensions.extraversion_introversion.covered = true;
    dimensions.extraversion_introversion.quality = assessAnswerQuality(userMessages, [...extraversionKeywords, ...introversionKeywords]);
  }
  
  // Sensing/Intuition indicators
  const sensingKeywords = ['details', 'facts', 'practical', 'step-by-step', 'concrete', 'specific', 'proven', 'experience'];
  const intuitionKeywords = ['big picture', 'possibilities', 'creative', 'innovative', 'pattern', 'future', 'theoretical', 'abstract'];
  
  if (hasRelevantAnswer(allContent, [...sensingKeywords, ...intuitionKeywords], ['learn', 'information', 'approach', 'method'])) {
    dimensions.sensing_intuition.covered = true;
    dimensions.sensing_intuition.quality = assessAnswerQuality(userMessages, [...sensingKeywords, ...intuitionKeywords]);
  }
  
  // Thinking/Feeling indicators
  const thinkingKeywords = ['logical', 'analysis', 'objective', 'pros and cons', 'rational', 'facts', 'direct', 'honest'];
  const feelingKeywords = ['feelings', 'values', 'harmony', 'people', 'emotions', 'considerate', 'tactful', 'impact'];
  
  if (hasRelevantAnswer(allContent, [...thinkingKeywords, ...feelingKeywords], ['decision', 'choose', 'feedback', 'important'])) {
    dimensions.thinking_feeling.covered = true;
    dimensions.thinking_feeling.quality = assessAnswerQuality(userMessages, [...thinkingKeywords, ...feelingKeywords]);
  }
  
  // Judging/Perceiving indicators
  const judgingKeywords = ['plan', 'schedule', 'organized', 'deadline', 'structure', 'early', 'steady', 'routine'];
  const perceivingKeywords = ['flexible', 'spontaneous', 'adapt', 'pressure', 'last minute', 'open', 'improvise'];
  
  if (hasRelevantAnswer(allContent, [...judgingKeywords, ...perceivingKeywords], ['schedule', 'plan', 'work', 'time', 'assignments'])) {
    dimensions.judging_perceiving.covered = true;
    dimensions.judging_perceiving.quality = assessAnswerQuality(userMessages, [...judgingKeywords, ...perceivingKeywords]);
  }
  
  // Calculate overall progress
  const coveredDimensions = Object.values(dimensions).filter(d => d.covered).length;
  const goodQualityAnswers = Object.values(dimensions).filter(d => d.quality === 'good').length;
  
  return {
    messageCount: userMessages.length,
    dimensions,
    coveredDimensions,
    goodQualityAnswers,
    isReadyForAnalysis: function() {
      return this.coveredDimensions >= 4 && goodQualityAnswers >= 3;
    },
    getMissingDimensions: function() {
      return Object.keys(dimensions).filter(key => !dimensions[key].covered);
    },
    needsClarification: function() {
      return Object.values(dimensions).some(d => d.covered && d.quality === 'poor');
    }
  };
}

// Helper function to check if content has relevant answers
function hasRelevantAnswer(content, keywords, contextWords) {
  const hasKeywords = keywords.some(keyword => content.includes(keyword));
  const hasContext = contextWords.some(word => content.includes(word));
  return hasKeywords && hasContext;
}

// Assess the quality of user answers
function assessAnswerQuality(userMessages, relevantKeywords) {
  const recentMessage = userMessages[userMessages.length - 1];
  if (!recentMessage) return 'none';
  
  const messageContent = recentMessage.content.toLowerCase();
  const messageLength = messageContent.length;
  
  // Check for poor quality indicators
  const poorQualityPhrases = [
    'i don\'t know', 'not sure', 'maybe', 'it depends', 'sometimes', 
    'both', 'either', 'hard to say', 'varies', 'depends on', 'idk'
  ];
  
  const hasPoorIndicators = poorQualityPhrases.some(phrase => messageContent.includes(phrase));
  const hasRelevantKeywords = relevantKeywords.some(keyword => messageContent.includes(keyword));
  
  if (hasPoorIndicators || messageLength < 10) {
    return 'poor';
  } else if (hasRelevantKeywords && messageLength > 20) {
    return 'good';
  } else {
    return 'fair';
  }
}

// Get next question based on analysis
function getNextQuestion(conversationAnalysis) {
  const { dimensions, needsClarification } = conversationAnalysis;
  
  // If we need clarification on a poor answer, address that first
  if (needsClarification()) {
    const poorDimension = Object.keys(dimensions).find(key => 
      dimensions[key].covered && dimensions[key].quality === 'poor'
    );
    
    switch(poorDimension) {
      case 'extraversion_introversion':
        return "Let me ask this differently: After a long, busy day, what specifically helps you feel recharged - spending time with friends and family, or having quiet time by yourself? Can you give me an example?";
      case 'sensing_intuition':
        return "I'd like to understand better: When you're learning something new (like using a new app or studying), do you prefer to get step-by-step instructions first, or do you like to explore and figure out the big picture yourself?";
      case 'thinking_feeling':
        return "Let me rephrase: When you need to make an important decision, what do you rely on more - analyzing the facts and logic, or considering how it will affect people's feelings? Can you give me a specific example?";
      case 'judging_perceiving':
        return "To clarify: In your daily life, do you prefer having a planned schedule and sticking to it, or do you like keeping things flexible and deciding what to do as you go?";
    }
  }
  
  // Ask about missing dimensions
  const missing = conversationAnalysis.getMissingDimensions();
  if (missing.length > 0) {
    const nextDimension = missing[0];
    
    switch(nextDimension) {
      case 'extraversion_introversion':
        return "After a busy day at school or work, what helps you recharge your energy: being around friends and family, or having some quiet time alone?";
      case 'sensing_intuition':
        return "When learning something new, do you prefer detailed, step-by-step instructions with examples, or do you like to see the big picture first and figure out the details yourself?";
      case 'thinking_feeling':
        return "When making important decisions, what influences you more: logical analysis of pros and cons, or considering how the decision will affect people's feelings and relationships?";
      case 'judging_perceiving':
        return "Do you prefer having a clear plan and schedule for your day, or do you like to keep things flexible and spontaneous, adapting as you go?";
      default:
        return "Tell me more about how you prefer to approach daily tasks and decisions.";
    }
  }
  
  return "I'd like to understand one more aspect of your personality. How do you typically handle deadlines and planning?";
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
  const conversationAnalysis = analyzeConversationDepth(messages);
  
  console.log('Conversation analysis:', {
    messageCount: conversationAnalysis.messageCount,
    coveredDimensions: conversationAnalysis.coveredDimensions,
    goodQualityAnswers: conversationAnalysis.goodQualityAnswers,
    isReady: conversationAnalysis.isReadyForAnalysis(),
    missing: conversationAnalysis.getMissingDimensions(),
    needsClarification: conversationAnalysis.needsClarification()
  });
  
  let lastError = null;
  
  for (const model of PREFERRED_MODELS) {
    try {
      console.log(`\n=== Trying model: ${model} ===`);
      
      // Build context-aware system prompt
      const contextualSystemPrompt = MBTI_SYSTEM_PROMPT + `\n\nCURRENT CONVERSATION STATUS:
- Messages exchanged: ${conversationAnalysis.messageCount}
- Dimensions covered: ${conversationAnalysis.coveredDimensions}/4
- Good quality answers: ${conversationAnalysis.goodQualityAnswers}
- Missing dimensions: ${conversationAnalysis.getMissingDimensions().join(', ') || 'None'}
- Needs clarification: ${conversationAnalysis.needsClarification()}
- Ready for analysis: ${conversationAnalysis.isReadyForAnalysis()}

DIMENSION STATUS:
${Object.entries(conversationAnalysis.dimensions).map(([dim, info]) => 
  `- ${dim.replace('_', '/')}: ${info.covered ? `Covered (${info.quality} quality)` : 'Not covered'}`
).join('\n')}

INSTRUCTION FOR THIS RESPONSE:
${conversationAnalysis.isReadyForAnalysis() ? 
  'Provide comprehensive MBTI analysis with high confidence (0.7-0.9)' :
  conversationAnalysis.needsClarification() ?
    'Ask for clarification on the poor quality answer before proceeding' :
    'Ask about the next missing dimension with specific, easy-to-answer questions'
}`;

      const requestBody = {
        model,
        messages: [
          { role: 'system', content: contextualSystemPrompt },
          ...messages
        ],
        max_tokens: 300,
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
      
      // Parse and validate the JSON content
      try {
        let parsed;
        if (typeof content === 'string') {
          const cleanContent = content.replace(/```json\s*|\s*```/g, '').trim();
          parsed = JSON.parse(cleanContent);
        } else {
          parsed = content;
        }
        
        // Enhanced validation and result building
        const result = {
          type: parsed.type || 'Unknown',
          confidence: Math.min(Math.max(parsed.confidence || 0.0, 0.0), 1.0),
          strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 5) : ['Engaging in self-reflection'],
          growth_tips: Array.isArray(parsed.growth_tips) ? parsed.growth_tips.slice(0, 5) : ['Continue exploring your preferences'],
          one_liner: parsed.one_liner || getNextQuestion(conversationAnalysis),
          validation_status: parsed.validation_status || 'need_more_info',
          missing_dimensions: parsed.missing_dimensions || conversationAnalysis.getMissingDimensions()
        };
        
        // Enforce validation rules
        if (!conversationAnalysis.isReadyForAnalysis()) {
          result.type = 'Unknown';
          result.confidence = 0.0;
          
          if (conversationAnalysis.needsClarification()) {
            result.validation_status = 'clarification_needed';
          } else {
            result.validation_status = 'need_more_info';
          }
          
          // Ensure we have a good question
          if (!result.one_liner || result.one_liner.length < 10) {
            result.one_liner = getNextQuestion(conversationAnalysis);
          }
        } else {
          // Ready for analysis - ensure good confidence
          result.validation_status = 'ready_for_analysis';
          result.confidence = Math.max(result.confidence, 0.7);
          result.missing_dimensions = [];
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
  
  // Enhanced fallback with proper question flow
  console.log('All models failed. Providing intelligent fallback...');
  
  const fallback = {
    type: "Unknown",
    confidence: 0.0,
    strengths: ["You're open to self-discovery", "You're engaging thoughtfully"],
    growth_tips: ["Take time to think about your natural preferences", "Answer based on what feels most authentic to you"],
    one_liner: getNextQuestion(conversationAnalysis),
    validation_status: conversationAnalysis.needsClarification() ? 'clarification_needed' : 'need_more_info',
    missing_dimensions: conversationAnalysis.getMissingDimensions()
  };
  
  return JSON.stringify(fallback);
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