// Complete fixed process-chat.js with proper syntax - FULL VERSION

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

// Enhanced system prompt with natural conversation flow
const MBTI_SYSTEM_PROMPT = `You are Mind-Mapper AI, a conversational MBTI personality analyst focused on natural, engaging dialogue.

CRITICAL RULES:
1) Output ONLY valid JSON (no code fences, no extra text)
2) Have natural conversations - don't rush to conclusions
3) Ask follow-up questions to understand context and nuance
4) Only provide MBTI analysis when you have sufficient insight (typically 6-8+ meaningful exchanges)
5) Be warm, encouraging, and genuinely curious about the person

CONVERSATION PHILOSOPHY:
- Quality over quantity: Better to have fewer, deeper insights than surface-level answers
- Build rapport before analysis
- Ask follow-up questions when answers are vague
- Show genuine interest in their experiences
- Validate their sharing before moving to next topic

CORE DIMENSIONS TO EXPLORE (with depth):
1. Energy source: Where do they get/lose energy? What recharges them? How do they process experiences?
2. Information processing: How do they learn best? What details matter to them? How do they approach new information?
3. Decision making: What factors matter most? How do they weigh options? What guides their choices?
4. Lifestyle preferences: How do they organize their world? What feels natural vs. stressful?

CONVERSATION STRATEGY:
- Start with one dimension and explore it thoroughly
- Ask follow-up questions: "Can you tell me more about..." "What does that look like for you?" "How do you typically..."
- Connect to their specific examples and experiences
- Validate their responses before moving on
- Only move to analysis after exploring ALL four dimensions meaningfully

ANALYSIS CRITERIA (ALL must be met):
- Has meaningfully discussed ALL 4 MBTI dimensions
- Provided specific examples or details (not just yes/no answers)
- At least 6-8 substantial exchanges
- Clear patterns are emerging
- User explicitly requests results OR conversation feels naturally complete

OUTPUT SCHEMA:
{
  "type": "<MBTI_TYPE|Unknown>",
  "confidence": <float 0.0-1.0>,
  "strengths": ["<strength>", "<strength>", "<strength>"],
  "growth_tips": ["<tip>", "<tip>", "<tip>"],
  "one_liner": "<question_or_personality_summary>",
  "ready_for_analysis": <boolean>,
  "progress": {
    "current_step": <1-5>,
    "total_steps": 5,
    "step_description": "<what we're exploring now>",
    "dimensions_explored": {
      "energy_source": <boolean>,
      "information_processing": <boolean>, 
      "decision_making": <boolean>,
      "lifestyle_preferences": <boolean>
    }
  }
}

STEP PROGRESSION:
1. "Getting to know you" - Initial rapport building
2. "Understanding your energy" - Explore extraversion/introversion deeply
3. "How you process information" - Explore sensing/intuition with examples
4. "Your decision-making style" - Explore thinking/feeling with scenarios
5. "Your lifestyle preferences" - Explore judging/perceiving, then analysis

When providing analysis:
- Set ready_for_analysis: true
- Choose most likely MBTI type based on conversation
- Set confidence between 0.65-0.85 (realistic based on conversation depth)
- Provide 3-4 specific strengths based on what they shared
- Give 3-4 practical, personalized growth tips
- Include encouraging summary of their type

When continuing conversation:
- Set ready_for_analysis: false
- Set type: "Unknown" 
- Set confidence: 0.0
- Use one_liner for natural next question or follow-up
- Update progress appropriately
- Keep strengths/tips encouraging but general`;

// Enhanced conversation analysis with dimension tracking
function analyzeConversation(messages) {
  const userMessages = messages.filter(m => m.role === 'user');
  const conversation = messages.map(m => m.content.toLowerCase()).join(' ');
  
  // Track which dimensions have been meaningfully explored
  const dimensions = {
    energy_source: false,
    information_processing: false,
    decision_making: false,
    lifestyle_preferences: false
  };
  
  // Energy source indicators
  const energyKeywords = ['recharge', 'energy', 'alone', 'people', 'social', 'quiet', 'friends', 'solitude', 'group', 'party', 'tired', 'drained', 'energized'];
  if (energyKeywords.some(keyword => conversation.includes(keyword))) {
    dimensions.energy_source = true;
  }
  
  // Information processing indicators  
  const infoKeywords = ['learn', 'details', 'big picture', 'step-by-step', 'instructions', 'creative', 'practical', 'abstract', 'concrete', 'possibilities', 'facts', 'innovative'];
  if (infoKeywords.some(keyword => conversation.includes(keyword))) {
    dimensions.information_processing = true;
  }
  
  // Decision making indicators
  const decisionKeywords = ['decide', 'choice', 'logical', 'feelings', 'analysis', 'emotions', 'rational', 'values', 'pros and cons', 'heart', 'head', 'impact'];
  if (decisionKeywords.some(keyword => conversation.includes(keyword))) {
    dimensions.decision_making = true;
  }
  
  // Lifestyle indicators
  const lifestyleKeywords = ['plan', 'flexible', 'schedule', 'spontaneous', 'organized', 'adapt', 'structure', 'routine', 'deadline', 'last minute', 'prepared'];
  if (lifestyleKeywords.some(keyword => conversation.includes(keyword))) {
    dimensions.lifestyle_preferences = true;
  }
  
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
  
  // Calculate total conversation depth
  const totalLength = userMessages.reduce((sum, msg) => sum + msg.content.length, 0);
  const avgMessageLength = totalLength / Math.max(userMessages.length, 1);
  
  // Count dimensions explored
  const dimensionsExplored = Object.values(dimensions).filter(Boolean).length;
  
  // Calculate progress step
  let currentStep = 1;
  let stepDescription = "Getting to know you";
  
  if (dimensionsExplored === 0 && userMessages.length <= 2) {
    currentStep = 1;
    stepDescription = "Getting to know you";
  } else if (dimensions.energy_source && dimensionsExplored === 1) {
    currentStep = 2;
    stepDescription = "Understanding your energy";
  } else if (dimensions.information_processing && dimensionsExplored >= 2) {
    currentStep = 3;
    stepDescription = "How you process information";
  } else if (dimensions.decision_making && dimensionsExplored >= 3) {
    currentStep = 4;
    stepDescription = "Your decision-making style";
  } else if (dimensionsExplored >= 4) {
    currentStep = 5;
    stepDescription = "Your lifestyle preferences";
  } else {
    // Still working on earlier dimensions
    if (!dimensions.energy_source) {
      currentStep = 2;
      stepDescription = "Understanding your energy";
    } else if (!dimensions.information_processing) {
      currentStep = 3;
      stepDescription = "How you process information";
    } else if (!dimensions.decision_making) {
      currentStep = 4;
      stepDescription = "Your decision-making style";
    } else {
      currentStep = 5;
      stepDescription = "Your lifestyle preferences";
    }
  }
  
  return {
    messageCount: userMessages.length,
    hasResultRequest,
    totalLength,
    avgMessageLength,
    dimensionsExplored,
    dimensions,
    currentStep,
    stepDescription,
    
    shouldProvideAnalysis: function() {
      // Only provide analysis if:
      // 1. All dimensions explored AND sufficient conversation depth
      // 2. OR explicit request + substantial conversation + most dimensions covered
      const hasDepth = this.messageCount >= 6 && this.avgMessageLength > 20;
      const allDimensionsCovered = this.dimensionsExplored >= 4;
      const substantialConversation = this.messageCount >= 4 && this.avgMessageLength > 15;
      const mostDimensionsCovered = this.dimensionsExplored >= 3;
      
      return (allDimensionsCovered && hasDepth) || 
             (this.hasResultRequest && substantialConversation && mostDimensionsCovered && this.messageCount >= 5);
    },
    
    needsMoreDepth: function() {
      // Need more depth if we've touched dimensions but answers are shallow
      return this.dimensionsExplored >= 2 && this.avgMessageLength < 15;
    },
    
    shouldExplainProcess: function() {
      // Explain process if they ask for results too early
      return this.hasResultRequest && this.messageCount <= 2;
    }
  };
}

// Get contextual follow-up questions
function getContextualQuestion(analysis, conversation) {
  const conv = conversation.toLowerCase();
  
  // If they asked for results too early
  if (analysis.shouldExplainProcess()) {
    return "I'd love to help you discover your MBTI type! I'll need to learn about your personality through conversation first. This usually takes about 5-7 questions to get a good read. Let's start: After a busy day, what helps you recharge - being around people or having some quiet time alone?";
  }
  
  // If we need more depth on current topic
  if (analysis.needsMoreDepth()) {
    return "That's helpful! Can you tell me a bit more about that? I'd love to understand what that looks like in your daily life.";
  }
  
  // Based on current step and what's been explored
  if (!analysis.dimensions.energy_source) {
    if (conv.includes('recharge') || conv.includes('energy')) {
      return "Interesting! Can you give me an example of a time when you felt really energized vs. a time when you felt drained? What was different about those situations?";
    }
    return "Let's start with something fundamental: After a busy day at school or work, what helps you recharge your energy - spending time with friends and talking, or having some quiet time alone to process?";
  }
  
  if (!analysis.dimensions.information_processing) {
    if (conv.includes('learn') || conv.includes('information')) {
      return "That makes sense! When you're learning something new - like a new app, hobby, or subject - do you prefer detailed step-by-step instructions, or do you like to explore and figure out the big picture yourself?";
    }
    return "Now I'm curious about how you process information. When learning something completely new, what approach works best for you - having detailed instructions to follow, or exploring and discovering patterns yourself?";
  }
  
  if (!analysis.dimensions.decision_making) {
    if (conv.includes('decision') || conv.includes('choice')) {
      return "Can you walk me through a recent important decision you made? What factors mattered most to you - the logical pros and cons, or how it would affect people and relationships?";
    }
    return "Let's talk about decision-making. When you have an important choice to make, what do you find yourself relying on more - logical analysis of the facts and outcomes, or considering how it will impact people and align with your values?";
  }
  
  if (!analysis.dimensions.lifestyle_preferences) {
    if (conv.includes('plan') || conv.includes('schedule')) {
      return "That's revealing! How do you typically handle unexpected changes to your plans? Do you find them stressful or kind of exciting?";
    }
    return "Almost done! I'm curious about your lifestyle approach - do you prefer having a clear plan and schedule for your day, or do you like keeping things flexible and adapting as opportunities come up?";
  }
  
  // All dimensions covered, ready for analysis
  if (analysis.hasResultRequest) {
    return "Perfect! I think I have a good sense of your personality now. Let me analyze your type...";
  }
  
  return "I'm getting a clear picture of your personality style! Based on our conversation, I can see some interesting patterns emerging. Would you like me to share your MBTI analysis, or is there anything else about your preferences you'd like to discuss?";
}

// Enhanced MBTI type inference with conversation context
function inferMBTIType(conversation, messages) {
  const conv = conversation.toLowerCase();
  const userResponses = messages.filter(m => m.role === 'user').map(m => m.content.toLowerCase());
  
  // E vs I - Look for energy patterns
  let eScore = 0, iScore = 0;
  
  const eIndicators = ['friends', 'people', 'social', 'group', 'team', 'talking', 'party', 'energized by others', 'discussion'];
  const iIndicators = ['alone', 'quiet', 'myself', 'independent', 'solitude', 'private', 'think first', 'recharge alone'];
  
  eIndicators.forEach(word => { if (conv.includes(word)) eScore++; });
  iIndicators.forEach(word => { if (conv.includes(word)) iScore++; });
  
  // Context-based scoring
  if (conv.includes('recharge') && conv.includes('alone')) iScore += 2;
  if (conv.includes('recharge') && conv.includes('people')) eScore += 2;
  if (conv.includes('drained') && conv.includes('social')) iScore += 1;
  if (conv.includes('energized') && conv.includes('group')) eScore += 1;
  
  const EI = iScore > eScore ? 'I' : 'E';
  
  // S vs N - Look for information processing patterns
  let sScore = 0, nScore = 0;
  
  const sIndicators = ['details', 'step-by-step', 'specific', 'practical', 'concrete', 'facts', 'instructions', 'hands-on', 'examples'];
  const nIndicators = ['big picture', 'creative', 'possibilities', 'innovative', 'abstract', 'future', 'patterns', 'concepts', 'theory'];
  
  sIndicators.forEach(word => { if (conv.includes(word)) sScore++; });
  nIndicators.forEach(word => { if (conv.includes(word)) nScore++; });
  
  // Context scoring
  if (conv.includes('learn') && conv.includes('step')) sScore += 1;
  if (conv.includes('learn') && conv.includes('explore')) nScore += 1;
  if (conv.includes('instructions') && conv.includes('prefer')) sScore += 2;
  if (conv.includes('figure out') && conv.includes('myself')) nScore += 1;
  
  const SN = nScore > sScore ? 'N' : 'S';
  
  // T vs F - Look for decision-making patterns
  let tScore = 0, fScore = 0;
  
  const tIndicators = ['logical', 'analysis', 'rational', 'objective', 'facts', 'pros and cons', 'efficient', 'fair'];
  const fIndicators = ['feelings', 'people', 'values', 'harmony', 'emotions', 'relationships', 'impact', 'care'];
  
  tIndicators.forEach(word => { if (conv.includes(word)) tScore++; });
  fIndicators.forEach(word => { if (conv.includes(word)) fScore++; });
  
  // Context scoring
  if (conv.includes('decision') && conv.includes('logical')) tScore += 2;
  if (conv.includes('decision') && conv.includes('feel')) fScore += 2;
  if (conv.includes('important') && conv.includes('people')) fScore += 1;
  if (conv.includes('important') && conv.includes('facts')) tScore += 1;
  
  const TF = fScore > tScore ? 'F' : 'T';
  
  // J vs P - Look for lifestyle patterns
  let jScore = 0, pScore = 0;
  
  const jIndicators = ['plan', 'schedule', 'organized', 'structure', 'deadline', 'routine', 'prepared', 'list'];
  const pIndicators = ['flexible', 'spontaneous', 'adapt', 'open', 'last minute', 'improvise', 'go with flow', 'change'];
  
  jIndicators.forEach(word => { if (conv.includes(word)) jScore++; });
  pIndicators.forEach(word => { if (conv.includes(word)) pScore++; });
  
  // Context scoring
  if (conv.includes('prefer') && conv.includes('plan')) jScore += 2;
  if (conv.includes('prefer') && conv.includes('flexible')) pScore += 2;
  if (conv.includes('stressful') && conv.includes('change')) jScore += 1;
  if (conv.includes('exciting') && conv.includes('change')) pScore += 1;
  
  const JP = pScore > jScore ? 'P' : 'J';
  
  return EI + SN + TF + JP;
}

// Enhanced type insights with personalization
function getTypeInsights(type) {
  const insights = {
    'INTJ': {
      strengths: ['Strategic thinking and long-term vision', 'Independent and self-directed learning', 'Strong analytical and problem-solving abilities', 'Confident in your convictions'],
      tips: ['Practice explaining complex ideas in simple terms', 'Make time for meaningful social connections', 'Be open to others\' perspectives and feedback', 'Balance planning with flexibility for unexpected opportunities']
    },
    'INTP': {
      strengths: ['Logical analysis and creative problem-solving', 'Adaptable and open to new ideas', 'Independent thinking and learning', 'Ability to see connections others miss'],
      tips: ['Set deadlines and accountability systems for projects', 'Practice communicating ideas clearly to others', 'Focus on practical applications of your theories', 'Develop routines for important daily tasks']
    },
    'ENTJ': {
      strengths: ['Natural leadership and organizational skills', 'Strategic planning and execution', 'Confident decision-making under pressure', 'Ability to motivate and direct others'],
      tips: ['Practice active listening and empathy', 'Show appreciation for others\' contributions', 'Balance work achievements with personal relationships', 'Consider the emotional impact of your decisions']
    },
    'ENTP': {
      strengths: ['Creative problem-solving and innovation', 'Enthusiastic and inspiring to others', 'Adaptable and quick-thinking', 'Excellent at seeing possibilities and connections'],
      tips: ['Follow through on commitments and projects', 'Create structured plans to achieve your goals', 'Practice patience with routine tasks', 'Focus on completing before starting new projects']
    },
    'INFJ': {
      strengths: ['Deep empathy and understanding of others', 'Visionary thinking and long-term perspective', 'Strong personal values and integrity', 'Ability to inspire and guide others'],
      tips: ['Set clear boundaries to prevent burnout', 'Express your needs and opinions more directly', 'Take time for practical, hands-on activities', 'Practice self-care and stress management']
    },
    'INFP': {
      strengths: ['Authentic and values-driven approach to life', 'Creative and imaginative thinking', 'Deep empathy and support for others', 'Adaptable and open-minded'],
      tips: ['Practice asserting yourself in groups and discussions', 'Set structured goals with specific deadlines', 'Share your ideas and insights more confidently', 'Develop practical skills alongside creative pursuits']
    },
    'ENFJ': {
      strengths: ['Inspiring and motivating others toward growth', 'Excellent communication and interpersonal skills', 'Organized and goal-oriented', 'Natural ability to understand and help others'],
      tips: ['Take regular time for self-care and reflection', 'Accept that you can\'t help everyone', 'Practice receiving feedback and criticism gracefully', 'Balance others\' needs with your own priorities']
    },
    'ENFP': {
      strengths: ['Enthusiastic and inspiring to be around', 'Excellent at building relationships and connections', 'Creative and adaptable problem-solving', 'Natural ability to see potential in people and situations'],
      tips: ['Create routines and systems to stay organized', 'Focus on completing projects before starting new ones', 'Practice patience with detailed, methodical tasks', 'Develop time management and planning skills']
    },
    'ISTJ': {
      strengths: ['Reliable and responsible in all commitments', 'Excellent attention to detail and accuracy', 'Strong work ethic and perseverance', 'Practical and logical approach to problems'],
      tips: ['Be open to new approaches and methods', 'Express appreciation and recognition for others', 'Try brainstorming creative solutions occasionally', 'Practice flexibility when plans need to change']
    },
    'ISFJ': {
      strengths: ['Caring and supportive of others\' well-being', 'Detail-oriented and thorough in work', 'Loyal and dependable in relationships', 'Practical help and service to others'],
      tips: ['Practice saying no when you\'re overcommitted', 'Share your accomplishments and successes more', 'Try new experiences outside your comfort zone', 'Express your own needs and preferences clearly']
    },
    'ESTJ': {
      strengths: ['Organized and efficient in managing tasks', 'Natural leadership and coordination abilities', 'Goal-oriented and results-focused', 'Decisive and confident in decision-making'],
      tips: ['Listen actively to different perspectives', 'Show flexibility when plans need adjustment', 'Acknowledge and appreciate others\' contributions', 'Consider the personal impact of decisions on people']
    },
    'ESFJ': {
      strengths: ['Excellent at supporting and encouraging others', 'Strong interpersonal and communication skills', 'Organized and dependable in commitments', 'Ability to create harmony in groups'],
      tips: ['Take time to focus on your own needs and goals', 'Practice handling conflict directly rather than avoiding it', 'Trust your own judgment more confidently', 'Set boundaries to prevent overcommitting to others']
    },
    'ISTP': {
      strengths: ['Practical problem-solving with hands-on approach', 'Calm and composed under pressure', 'Adaptable and flexible in changing situations', 'Independent and self-reliant'],
      tips: ['Practice expressing emotions and feelings more openly', 'Plan ahead for important long-term goals', 'Engage more actively in group discussions', 'Share your expertise and knowledge with others']
    },
    'ISFP': {
      strengths: ['Authentic and true to your personal values', 'Sensitive and caring toward others\' feelings', 'Adaptable and flexible in approach', 'Creative and artistic sensibilities'],
      tips: ['Speak up more confidently for your ideas and opinions', 'Set clearer boundaries in relationships', 'Practice planning and organization skills', 'Take leadership roles in areas you care about']
    },
    'ESTP': {
      strengths: ['Energetic and action-oriented approach', 'Excellent at reading people and social situations', 'Adaptable and resourceful in problem-solving', 'Ability to motivate others through enthusiasm'],
      tips: ['Think through consequences before acting in important situations', 'Create and work toward longer-term goals', 'Practice patience with theoretical or abstract concepts', 'Develop planning and organizational systems']
    },
    'ESFP': {
      strengths: ['Enthusiastic and fun-loving personality', 'Excellent at encouraging and supporting others', 'Spontaneous and flexible in approach', 'Strong interpersonal and social skills'],
      tips: ['Practice planning ahead for important commitments', 'Focus on completing tasks before starting new ones', 'Take regular time for quiet reflection and introspection', 'Develop systems for managing details and deadlines']
    }
  };
  
  return insights[type] || {
    strengths: ['Self-aware and committed to personal growth', 'Open to new experiences and learning', 'Thoughtful in your approach to life', 'Willing to engage in meaningful self-reflection'],
    tips: ['Continue exploring your personality preferences', 'Practice self-reflection regularly', 'Stay open to feedback and growth opportunities', 'Build on your natural strengths while developing new skills']
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
  
  console.log('Enhanced conversation analysis:', {
    messageCount: conversationAnalysis.messageCount,
    dimensionsExplored: conversationAnalysis.dimensionsExplored,
    dimensions: conversationAnalysis.dimensions,
    currentStep: conversationAnalysis.currentStep,
    stepDescription: conversationAnalysis.stepDescription,
    shouldProvideAnalysis: conversationAnalysis.shouldProvideAnalysis(),
    needsMoreDepth: conversationAnalysis.needsMoreDepth()
  });
  
  let lastError = null;
  
  for (const model of PREFERRED_MODELS) {
    try {
      console.log(`\n=== Trying model: ${model} ===`);
      
      // Build enhanced context for the AI
      const contextualPrompt = MBTI_SYSTEM_PROMPT + `\n\nCONVERSATION ANALYSIS:
- Message count: ${conversationAnalysis.messageCount}
- Current step: ${conversationAnalysis.currentStep}/5 - ${conversationAnalysis.stepDescription}
- Dimensions explored: ${conversationAnalysis.dimensionsExplored}/4
- Energy source explored: ${conversationAnalysis.dimensions.energy_source}
- Information processing explored: ${conversationAnalysis.dimensions.information_processing}
- Decision making explored: ${conversationAnalysis.dimensions.decision_making}
- Lifestyle preferences explored: ${conversationAnalysis.dimensions.lifestyle_preferences}
- Should provide analysis: ${conversationAnalysis.shouldProvideAnalysis()}
- Needs more depth: ${conversationAnalysis.needsMoreDepth()}
- Should explain process: ${conversationAnalysis.shouldExplainProcess()}

INSTRUCTION:
${conversationAnalysis.shouldExplainProcess() ? 
  'User asked for results too early. Explain the process warmly and ask the first meaningful question about energy/recharge. Set ready_for_analysis: false, current_step: 1.' :
  conversationAnalysis.shouldProvideAnalysis() ? 
    'Provide complete MBTI analysis. User has shared enough meaningful information across dimensions. Set ready_for_analysis: true, current_step: 5.' :
    conversationAnalysis.needsMoreDepth() ?
      'Ask a follow-up question to get more depth on the current topic. Don\'t move to next dimension yet.' :
      'Continue exploring dimensions naturally. Ask about the next unexplored dimension or deepen current one. Set ready_for_analysis: false.'
}`;

      const requestBody = {
        model,
        messages: [
          { role: 'system', content: contextualPrompt },
          ...messages
        ],
        max_tokens: 450,
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
        
        // Build final result with enhanced logic
        let result;
        
        if (conversationAnalysis.shouldExplainProcess()) {
          // Explain process warmly
          result = {
            type: 'Unknown',
            confidence: 0.0,
            strengths: ['Curious about self-discovery', 'Taking initiative in personal growth'],
            growth_tips: ['Share your authentic preferences', 'Think about what feels most natural to you'],
            one_liner: getContextualQuestion(conversationAnalysis, fullConversation),
            ready_for_analysis: false,
            progress: {
              current_step: 1,
              total_steps: 5,
              step_description: "Getting to know you",
              dimensions_explored: conversationAnalysis.dimensions
            }
          };
        } else if (conversationAnalysis.shouldProvideAnalysis()) {
          // Provide analysis - override AI decision if criteria met
          const inferredType = inferMBTIType(fullConversation, messages);
          const insights = getTypeInsights(inferredType);
          
          // Calculate confidence based on conversation quality
          let confidence = 0.65;
          if (conversationAnalysis.dimensionsExplored >= 4) confidence += 0.1;
          if (conversationAnalysis.avgMessageLength > 30) confidence += 0.05;
          if (conversationAnalysis.messageCount >= 8) confidence += 0.05;
          confidence = Math.min(confidence, 0.85);
          
          result = {
            type: inferredType,
            confidence: confidence,
            strengths: insights.strengths,
            growth_tips: insights.tips,
            one_liner: `Based on our conversation, you show strong ${inferredType} characteristics in how you approach energy, information, decisions, and lifestyle.`,
            ready_for_analysis: true,
            progress: {
              current_step: 5,
              total_steps: 5,
              step_description: "Analysis complete!",
              dimensions_explored: conversationAnalysis.dimensions
            }
          };
          
          console.log('PROVIDING ANALYSIS with type:', inferredType, 'confidence:', confidence);
        } else {
          // Continue conversation - use AI response but ensure progress tracking
          const baseResult = {
            type: 'Unknown',
            confidence: 0.0,
            strengths: ['Engaging thoughtfully in self-discovery', 'Open to exploring your personality'],
            growth_tips: ['Continue sharing specific examples', 'Think about your natural preferences'],
            ready_for_analysis: false,
            progress: {
              current_step: conversationAnalysis.currentStep,
              total_steps: 5,
              step_description: conversationAnalysis.stepDescription,
              dimensions_explored: conversationAnalysis.dimensions
            }
          };
          
          // Use AI's one_liner if good, otherwise use contextual question
          if (parsed.one_liner && parsed.one_liner.length > 10) {
            baseResult.one_liner = parsed.one_liner;
          } else {
            baseResult.one_liner = getContextualQuestion(conversationAnalysis, fullConversation);
          }
          
          // Use AI's progress if provided, otherwise use our analysis
          if (parsed.progress) {
            baseResult.progress = { ...baseResult.progress, ...parsed.progress };
          }
          
          result = baseResult;
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
  
  // Enhanced fallback with progress tracking
  console.log('All models failed. Providing enhanced fallback...');
  
  if (conversationAnalysis.shouldExplainProcess()) {
    return JSON.stringify({
      type: "Unknown",
      confidence: 0.0,
      strengths: ["Eager to learn about yourself", "Taking steps toward self-awareness"],
      growth_tips: ["Share your natural preferences honestly", "Think about what energizes you"],
      one_liner: getContextualQuestion(conversationAnalysis, fullConversation),
      ready_for_analysis: false,
      progress: {
        current_step: 1,
        total_steps: 5,
        step_description: "Getting to know you",
        dimensions_explored: conversationAnalysis.dimensions
      }
    });
  }
  
  if (conversationAnalysis.shouldProvideAnalysis()) {
    const inferredType = inferMBTIType(fullConversation, messages);
    const insights = getTypeInsights(inferredType);
    
    return JSON.stringify({
      type: inferredType,
      confidence: 0.7,
      strengths: insights.strengths,
      growth_tips: insights.tips,
      one_liner: `Based on our conversation, you demonstrate ${inferredType} characteristics.`,
      ready_for_analysis: true,
      progress: {
        current_step: 5,
        total_steps: 5,
        step_description: "Analysis complete!",
        dimensions_explored: conversationAnalysis.dimensions
      }
    });
  } else {
    return JSON.stringify({
      type: "Unknown",
      confidence: 0.0,
      strengths: ["You're engaging thoughtfully in self-discovery", "You're sharing meaningful insights"],
      growth_tips: ["Keep sharing your authentic preferences", "Think about specific examples from your life"],
      one_liner: getContextualQuestion(conversationAnalysis, fullConversation),
      ready_for_analysis: false,
      progress: {
        current_step: conversationAnalysis.currentStep,
        total_steps: 5,
        step_description: conversationAnalysis.stepDescription,
        dimensions_explored: conversationAnalysis.dimensions
      }
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