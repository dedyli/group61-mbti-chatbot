// personality-chat.cjs - Dedicated MBTI personality analysis function

const { SecurityManager, callOpenAI, saveConversation, CONFIG } = require('./shared-utils');
const crypto = require('crypto');

// MBTI Personality Analysis System Prompt
const PERSONALITY_PROMPT = `You are Mind-Mapper AI, a sophisticated and empathetic MBTI personality analyst. Your goal is to determine a user's personality type through a natural, insightful, and flowing conversation.

**Core Directives:**
1. **Strict JSON Output:** You MUST ONLY output a single, valid JSON object without any markdown formatting (like \`\`\`json), commentary, or extra text.
2. **Conversational Flow:** Do not be robotic. Engage the user in a warm, curious, and human-like dialogue. Build rapport before diving deep. Ask clarifying follow-up questions to understand nuance.
3. **Holistic Analysis:** You are responsible for determining when you have sufficient information to make a confident assessment. This typically requires exploring all four MBTI dimensions, but the depth of the conversation is more important than the number of messages.
4. **Dynamic Progress Tracking:** You must dynamically update the 'progress' object based on your analysis of the conversation's depth in each of the four core MBTI dimensions:
   * **Energy Source (Introversion vs. Extraversion):** How do they gain and lose energy?
   * **Information Processing (Sensing vs. Intuition):** Do they focus on concrete facts or abstract possibilities?
   * **Decision Making (Thinking vs. Feeling):** Do they prioritize logic or human values?
   * **Lifestyle & Organization (Judging vs. Perceiving):** Do they prefer structure or spontaneity?

**JSON Output Schema:**
Your entire response must conform to this schema.

- **For an ongoing conversation:**
{
  "ready_for_analysis": false,
  "one_liner": "<Your natural, engaging follow-up question or reflective comment.>",
  "progress": {
    "current_step": <integer 1-5>,
    "total_steps": 5,
    "step_description": "<A brief description of the current conversational focus, e.g., 'Exploring your decision-making style'>",
    "dimensions_explored": { 
      "energy_source": <bool>, 
      "information_processing": <bool>, 
      "decision_making": <bool>, 
      "lifestyle_preferences": <bool> 
    }
  }
}

- **When providing the final analysis (set "ready_for_analysis" to true):**
{
  "ready_for_analysis": true,
  "type": "<The inferred 4-letter MBTI type, e.g., 'INFJ'>",
  "confidence": <float between 0.6 and 0.95, representing your confidence>,
  "one_liner": "<A concise, one-sentence summary of this personality type.>",
  "reasoning": "<A brief paragraph explaining *why* you chose this type, referencing themes from the conversation. This is crucial.>",
  "strengths": ["<A key strength derived from the conversation>", "<Another key strength>", "<A third strength>"],
  "growth_tips": ["<A practical growth tip relevant to the user>", "<Another practical tip>", "<A third tip>"],
  "progress": {
    "current_step": 5,
    "total_steps": 5,
    "step_description": "Analysis complete",
    "dimensions_explored": { 
      "energy_source": true, 
      "information_processing": true, 
      "decision_making": true, 
      "lifestyle_preferences": true 
    }
  }
}

**Cultural Sensitivity:** Be aware that communication styles vary across cultures. Consider the user's language choice and adjust your interpretation accordingly.

**Your Task Now:**
Analyze the provided message history.
- If the conversation is still developing, update the progress, ask a relevant and insightful follow-up question, and set "ready_for_analysis" to false.
- If the conversation has sufficient depth across all dimensions OR the user explicitly asks for their result with enough context, provide the complete, final analysis and set "ready_for_analysis" to true.`;

// Initialize security manager
const securityManager = new SecurityManager();

// Main handler function
exports.handler = async (event) => {
  const startTime = Date.now();
  const origin = event.headers?.origin || '';
  const ip = securityManager.getClientIP(event);
  const userAgent = event.headers?.['user-agent'] || '';
  const secureHeaders = securityManager.getSecureHeaders(origin);

  console.log(`🧠 Personality analysis request from ${securityManager.hashIP(ip)}`);

  // Handle preflight CORS requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: secureHeaders,
      body: ''
    };
  }

  // Validate HTTP method
  if (event.httpMethod !== 'POST') {
    await securityManager.logSecurityEvent('INVALID_METHOD', ip, {
      method: event.httpMethod
    });
    return {
      statusCode: 405,
      headers: secureHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Validate origin
  if (!securityManager.validateOrigin(origin)) {
    await securityManager.logSecurityEvent('INVALID_ORIGIN', ip, { origin });
    return {
      statusCode: 403,
      headers: secureHeaders,
      body: JSON.stringify({ error: 'Origin not allowed' })
    };
  }

  // Rate limiting for personality analysis (10 requests per minute)
  const rateLimitPassed = await securityManager.checkRateLimit(ip, 10, 60000);
  if (!rateLimitPassed) {
    return {
      statusCode: 429,
      headers: {
        ...secureHeaders,
        'Retry-After': '60'
      },
      body: JSON.stringify({
        error: 'Too many requests. Please try again in a minute.',
        retryAfter: 60
      })
    };
  }

  // Check request size
  const requestSize = Buffer.byteLength(event.body || '{}');
  if (requestSize > CONFIG.security.maxRequestSize) {
    await securityManager.logSecurityEvent('REQUEST_TOO_LARGE', ip, {
      size: requestSize
    });
    return {
      statusCode: 413,
      headers: secureHeaders,
      body: JSON.stringify({ error: 'Request too large' })
    };
  }

  try {
    // Parse and validate request body
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (parseError) {
      await securityManager.logSecurityEvent('INVALID_JSON', ip, {
        error: parseError.message
      });
      return {
        statusCode: 400,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'Invalid JSON format' })
      };
    }

    const { messages } = body;

    // Validate messages
    if (!securityManager.validateMessages(messages)) {
      return {
        statusCode: 400,
        headers: secureHeaders,
        body: JSON.stringify({
          error: 'Invalid message format or content',
          details: 'Please check your message length and content'
        })
      };
    }

    // Sanitize message content
    const sanitizedMessages = messages.map(msg => ({
      role: msg.role,
      content: securityManager.sanitizeInput(msg.content, CONFIG.validation.maxMessageLength)
    }));

    console.log(`🔥 Processing ${sanitizedMessages.length} personality messages`);

    // Get AI response using shared function
    let aiResponse;
    try {
      aiResponse = await callOpenAI(sanitizedMessages, PERSONALITY_PROMPT, 'personality');
    } catch (error) {
      console.error('❌ OpenAI call failed:', error.message);
      
      // Return fallback JSON response
      const fallbackResponse = JSON.stringify({
        ready_for_analysis: false,
        one_liner: "I'm experiencing a temporary connection issue. Could you please try asking that again in a moment?",
        progress: {
          current_step: 1,
          total_steps: 5,
          step_description: "System error - please retry",
          dimensions_explored: {
            energy_source: false,
            information_processing: false,
            decision_making: false,
            lifestyle_preferences: false
          }
        }
      });
      
      aiResponse = fallbackResponse;
    }

    // Determine if this is a final analysis
    let isFinalAnalysis = false;
    try {
      const aiData = JSON.parse(aiResponse);
      isFinalAnalysis = aiData.ready_for_analysis === true;
      console.log(`🔍 PERSONALITY ANALYSIS: ready_for_analysis = ${isFinalAnalysis}`);
    } catch (e) {
      console.log('🔍 Could not parse personality response as JSON, treating as ongoing');
    }

    // Prepare security context for database save
    const securityContext = {
      ipHash: securityManager.hashIP(ip),
      userAgentHash: crypto.createHash('sha256').update(userAgent + CONFIG.security.hashSalt).digest('hex').substring(0, 16),
      isFinalAnalysis,
      language: body.language || 'en'
    };

    // Save to database using shared function
    const conversationId = await saveConversation(
      sanitizedMessages,
      aiResponse,
      securityContext,
      'personality'
    );

    // Log successful completion
    const processingTime = Date.now() - startTime;
    console.log(`✅ Personality request completed in ${processingTime}ms for conversation ${conversationId}`);

    // Log performance metrics
    if (processingTime > 10000) { // Log slow requests (>10s)
      console.warn(`⚠️ Slow personality request detected: ${processingTime}ms`);
    }

    return {
      statusCode: 200,
      headers: {
        ...secureHeaders,
        'Content-Type': 'application/json',
        'X-Response-Time': processingTime.toString(),
        'X-Service-Type': 'personality'
      },
      body: JSON.stringify({
        reply: aiResponse,
        conversation_id: conversationId,
        service_type: 'personality',
        processing_time: processingTime
      })
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    await securityManager.logSecurityEvent('PROCESSING_ERROR', ip, {
      error: error.message,
      processingTime
    });

    console.error('💥 Unhandled error in personality handler:', error);

    return {
      statusCode: 500,
      headers: secureHeaders,
      body: JSON.stringify({
        error: 'An error occurred while processing your request',
        requestId: Date.now().toString()
      })
    };
  }
};