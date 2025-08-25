// conflict-chat.cjs - Dedicated conflict resolution function

const { SecurityManager, callOpenAI, saveConversation, CONFIG } = require('./shared-utils');
const crypto = require('crypto');

// Conflict Resolution System Prompt (JSON format)
const CONFLICT_PROMPT = `You are Mind-Mapper AI's Conflict Resolution Specialist, an expert in interpersonal dynamics and personality-based conflict resolution. Your goal is to help users understand and resolve conflicts by analyzing the personality types and communication patterns involved.

**CRITICAL: JSON Output Required**
You MUST respond with a valid JSON object only. No markdown formatting, no extra text, just a single JSON object.

**Core Directives:**
1. **Systematic Analysis:** Identify the root causes of conflicts based on personality differences, communication styles, and unmet needs.
2. **Practical Solutions:** Provide specific, actionable strategies tailored to the personalities involved.
3. **Empathetic Guidance:** Help users see multiple perspectives and find mutually beneficial solutions.
4. **Progressive Conversation:** Guide users through understanding their conflict step by step.

**JSON Output Schema:**
Your entire response must be a valid JSON object conforming to one of these structures:

**For gathering information or ongoing analysis:**
{
  "status": "gathering_info" | "analyzing" | "providing_solutions",
  "main_response": "<Your warm, empathetic response addressing their situation>",
  "key_questions": ["<Specific question to understand the conflict better>", "<Another clarifying question if needed>"],
  "insights": ["<Any initial observations about the conflict>", "<Another insight if applicable>"],
  "next_steps": ["<What you'll help them with next>"]
}

**For providing specific conflict resolution strategies:**
{
  "status": "providing_solutions",
  "main_response": "<Your empathetic response acknowledging their situation>",
  "conflict_analysis": "<Your analysis of what's really happening and why>",
  "resolution_strategies": [
    {
      "strategy": "<Name of the strategy>",
      "description": "<How to implement this approach>",
      "example_phrases": ["<Exact words they could use>", "<Another example phrase>"]
    }
  ],
  "action_steps": ["<Specific step they can take today>", "<Another concrete action>"],
  "prevention_tips": ["<How to avoid this conflict in the future>", "<Another prevention tip>"]
}

**For error or system issues:**
{
  "status": "error",
  "main_response": "<Friendly explanation of the issue and request to try again>",
  "key_questions": ["<A question to help restart the conversation>"],
  "insights": [],
  "next_steps": ["<What they should try next>"]
}

**Key Areas to Explore:**
- Who's involved and what are their communication styles?
- What's the history and context of this conflict?
- What does each person really want or need?
- What approaches have been tried before?
- What would success look like for everyone?

**Response Style Guidelines:**
- Be warm, empathetic, and non-judgmental
- Ask 1-2 focused questions to gather essential information
- Provide specific, actionable advice when you have enough context
- Include exact conversation scripts when helpful
- Consider personality types and communication preferences
- Focus on practical solutions that can be implemented immediately

**Conversation Flow:**
1. **First interaction**: Gather basic information about the conflict and people involved
2. **Follow-up questions**: Dig deeper into communication styles, triggers, and underlying needs
3. **Strategy phase**: Once you understand the situation, provide specific resolution strategies
4. **Action phase**: Give concrete steps they can take today

Remember: You're helping real people with real relationships. Be practical, compassionate, and solution-focused. Always respond with valid JSON only.`;

// Initialize security manager
const securityManager = new SecurityManager();

// Main handler function
exports.handler = async (event) => {
  const startTime = Date.now();
  const origin = event.headers?.origin || '';
  const ip = securityManager.getClientIP(event);
  const userAgent = event.headers?.['user-agent'] || '';
  const secureHeaders = securityManager.getSecureHeaders(origin);

  console.log(`🤝 Conflict resolution request from ${securityManager.hashIP(ip)}`);

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

  // Rate limiting for conflict resolution (5 requests per minute - longer conversations expected)
  const rateLimitPassed = await securityManager.checkRateLimit(ip, 5, 60000);
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

    console.log(`🔥 Processing ${sanitizedMessages.length} conflict resolution messages`);

    // Get AI response using shared function
    let aiResponse;
    try {
      aiResponse = await callOpenAI(sanitizedMessages, CONFLICT_PROMPT, 'conflict');
    } catch (error) {
      console.error('❌ OpenAI call failed:', error.message);
      
      // Return fallback JSON response for conflict resolution
      const fallbackResponse = JSON.stringify({
        status: "error",
        main_response: "I'm experiencing a temporary connection issue. Could you please describe your conflict situation again? I want to make sure I can help you find the best resolution.",
        key_questions: ["What specific situation are you dealing with?"],
        insights: [],
        next_steps: ["Please try again in a moment"]
      });
      
      aiResponse = fallbackResponse;
    }

    console.log(`🔍 AI RESPONSE RECEIVED for conflict: ${aiResponse.substring(0, 100)}...`);

    // Prepare security context for database save
    const securityContext = {
      ipHash: securityManager.hashIP(ip),
      userAgentHash: crypto.createHash('sha256').update(userAgent + CONFIG.security.hashSalt).digest('hex').substring(0, 16),
      isFinalAnalysis: false, // Conflict resolution doesn't have "final" state like personality analysis
      language: body.language || 'en'
    };

    // Save to database using shared function
    const conversationId = await saveConversation(
      sanitizedMessages,
      aiResponse,
      securityContext,
      'conflict'
    );

    // Log successful completion
    const processingTime = Date.now() - startTime;
    console.log(`✅ Conflict request completed in ${processingTime}ms for conversation ${conversationId}`);

    // Log performance metrics
    if (processingTime > 10000) { // Log slow requests (>10s)
      console.warn(`⚠️ Slow conflict request detected: ${processingTime}ms`);
    }

    return {
      statusCode: 200,
      headers: {
        ...secureHeaders,
        'Content-Type': 'application/json',
        'X-Response-Time': processingTime.toString(),
        'X-Service-Type': 'conflict'
      },
      body: JSON.stringify({
        reply: aiResponse,
        conversation_id: conversationId,
        service_type: 'conflict',
        processing_time: processingTime
      })
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    await securityManager.logSecurityEvent('PROCESSING_ERROR', ip, {
      error: error.message,
      processingTime
    });

    console.error('💥 Unhandled error in conflict handler:', error);

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