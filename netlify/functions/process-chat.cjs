// process-chat.js - Production-Ready Secure Implementation with Dual Services
// Mind-Mapper AI - Enhanced Security with Personality Analysis & Conflict Resolution

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// --- 1. SECURITY CONFIGURATION ---

// Environment-based configuration
const CONFIG = {
  // Allowed origins (CRITICAL: Update these to your actual domains)
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:8080').split(','),
  
  // Rate limiting settings
  rateLimits: {
    chat: { requests: 10, windowMs: 60000 },      // 10 requests per minute
    contact: { requests: 3, windowMs: 300000 },   // 3 requests per 5 minutes
    feedback: { requests: 5, windowMs: 60000 }    // 5 requests per minute
  },
  
  // Input validation rules
  validation: {
    maxMessageLength: 2000,
    maxMessagesPerConversation: 50,
    maxContactMessageLength: 5000,
    allowedLanguages: ['en', 'vi', 'zh'],
    allowedServiceTypes: ['personality', 'conflict'],
    minMessageLength: 1
  },
  
  // OpenAI configuration
  openai: {
    model: "gpt-4o", // Updated to use available model
    maxTokens: 800,
    temperature: 0.75,
    timeout: 30000
  },
  
  // Security settings
  security: {
    hashSalt: process.env.HASH_SALT || 'mindmapper-secure-salt-2024',
    maxRequestSize: 1024 * 1024, // 1MB
    ipHashEnabled: true,
    detailedLogging: process.env.NODE_ENV !== 'production'
  }
};

// --- 2. INITIALIZE SUPABASE CLIENT ---

let supabaseClient = null;

function initializeSupabase() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    try {
      supabaseClient = createClient(
        process.env.SUPABASE_URL, 
        process.env.SUPABASE_SERVICE_KEY,
        {
          auth: { persistSession: false },
          db: { schema: 'public' }
        }
      );
      console.log('✅ Supabase client initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Supabase client:', error.message);
      return false;
    }
  } else {
    console.error('❌ Missing Supabase environment variables');
    return false;
  }
}

// Initialize on startup
const supabaseInitialized = initializeSupabase();

// --- 3. AI SYSTEM PROMPTS ---

const MBTI_PERSONALITY_PROMPT = `You are Mind-Mapper AI, a sophisticated and empathetic MBTI personality analyst. Your goal is to determine a user's personality type through a natural, insightful, and flowing conversation.

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

const CONFLICT_RESOLUTION_PROMPT = `You are Mind-Mapper AI's Conflict Resolution Specialist, an expert in interpersonal dynamics and personality-based conflict resolution. Your goal is to help users understand and resolve conflicts by analyzing the personality types and communication patterns involved.

**CRITICAL: Response Format**
You MUST respond in natural, flowing text - NOT JSON format. Never use JSON structure in your responses.

**Core Directives:**
1. **Natural Conversation:** Engage users warmly and professionally. Ask clarifying questions to understand the full context.
2. **Systematic Analysis:** Identify the root causes of conflicts based on personality differences, communication styles, and unmet needs.
3. **Practical Solutions:** Provide specific, actionable strategies tailored to the personalities involved.
4. **Empathetic Guidance:** Help users see multiple perspectives and find mutually beneficial solutions.

**Your Approach:**
1. **Understand the Situation:** Ask about who's involved, what happened, what each person wants/needs, and what's been tried before.
2. **Identify Patterns:** Look for personality clashes, communication breakdowns, value conflicts, or unmet needs.
3. **Provide Solutions:** Offer specific conversation scripts, timing suggestions, compromise strategies, and prevention tips.

**Key Areas to Explore:**
- **The People:** What are their communication styles, work preferences, values, and stress triggers?
- **The Context:** Is this workplace, family, romantic relationship, friendship? What's the history?
- **The Core Issue:** Is it about tasks, relationships, values, or external pressures?
- **Desired Outcome:** What would success look like for everyone involved?

**Response Style:**
- Be conversational and empathetic, not clinical
- Ask one or two focused questions to dig deeper
- Provide specific, actionable advice when you have enough context
- Include exact phrases or approaches the user can try
- Consider timing, setting, and approach for difficult conversations

**Response Format:**
Respond in natural, flowing text (not JSON). Structure your responses with:
- Acknowledgment of their situation
- Key insights about what might be happening
- Specific suggestions or questions to move forward
- Encouragement and support

Remember: You're helping real people with real relationships. Be practical, compassionate, and solution-focused.`;

// --- 4. SECURITY MANAGEMENT CLASS ---

class SecurityManager {
  constructor() {
    this.rateLimit = new Map();
    this.suspiciousActivity = new Map();
    this.startCleanupInterval();
  }

  // Get client IP address with multiple fallbacks
  getClientIP(event) {
    const headers = event.headers || {};
    const forwarded = headers['x-forwarded-for'];
    const realIP = headers['x-real-ip'];
    const clientIP = headers['client-ip'];
    const cfConnectingIP = headers['cf-connecting-ip']; // Cloudflare
    
    let ip = 'unknown';
    
    if (forwarded) {
      // X-Forwarded-For can contain multiple IPs, take the first one
      ip = forwarded.split(',')[0].trim();
    } else if (realIP) {
      ip = realIP;
    } else if (clientIP) {
      ip = clientIP;
    } else if (cfConnectingIP) {
      ip = cfConnectingIP;
    } else if (event.requestContext?.identity?.sourceIp) {
      ip = event.requestContext.identity.sourceIp;
    }
    
    return ip;
  }

  // Hash IP for privacy while maintaining ability to rate limit
  hashIP(ip) {
    if (!CONFIG.security.ipHashEnabled) return ip;
    return crypto
      .createHash('sha256')
      .update(ip + CONFIG.security.hashSalt)
      .digest('hex')
      .substring(0, 16);
  }

  // Validate origin against allowed list
  validateOrigin(origin) {
    if (!origin) return false;
    
    // In development, allow localhost
    if (process.env.NODE_ENV === 'development') {
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        return true;
      }
    }
    
    return CONFIG.allowedOrigins.includes(origin);
  }

  // Rate limiting implementation
  async checkRateLimit(ip, endpoint) {
    const hashedIP = this.hashIP(ip);
    const limit = CONFIG.rateLimits[endpoint];
    
    if (!limit) return true;

    const key = `${hashedIP}:${endpoint}`;
    const now = Date.now();
    
    // Get or create rate limit record
    if (!this.rateLimit.has(key)) {
      this.rateLimit.set(key, []);
    }
    
    const timestamps = this.rateLimit.get(key);
    
    // Remove expired timestamps
    const validTimestamps = timestamps.filter(time => now - time < limit.windowMs);
    
    // Check if limit exceeded
    if (validTimestamps.length >= limit.requests) {
      this.logSecurityEvent('RATE_LIMIT_EXCEEDED', ip, { 
        endpoint, 
        requestCount: validTimestamps.length,
        limit: limit.requests 
      });
      return false;
    }
    
    // Add current timestamp
    validTimestamps.push(now);
    this.rateLimit.set(key, validTimestamps);
    
    return true;
  }

  // Input validation and sanitization
  sanitizeInput(input, maxLength = 1000) {
    if (typeof input !== 'string') return '';
    
    return input
      .trim()
      .slice(0, maxLength)
      .replace(/[<>]/g, '') // Remove potential HTML tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/data:/gi, '') // Remove data: protocol
      .replace(/vbscript:/gi, '') // Remove vbscript: protocol
      .replace(/on\w+=/gi, ''); // Remove event handlers
  }

  // Validate conversation messages
  validateMessages(messages) {
    if (!Array.isArray(messages)) {
      this.logValidationError('messages_not_array', typeof messages);
      return false;
    }
    
    if (messages.length === 0) {
      this.logValidationError('messages_empty');
      return false;
    }
    
    if (messages.length > CONFIG.validation.maxMessagesPerConversation) {
      this.logValidationError('messages_too_many', messages.length);
      return false;
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      
      if (!msg || typeof msg !== 'object') {
        this.logValidationError('invalid_message_object', i);
        return false;
      }
      
      if (!['user', 'assistant'].includes(msg.role)) {
        this.logValidationError('invalid_role', msg.role);
        return false;
      }
      
      if (typeof msg.content !== 'string') {
        this.logValidationError('invalid_content_type', typeof msg.content);
        return false;
      }
      
      if (msg.content.length > CONFIG.validation.maxMessageLength) {
        this.logValidationError('message_too_long', msg.content.length);
        return false;
      }
      
      if (msg.content.trim().length < CONFIG.validation.minMessageLength) {
        this.logValidationError('message_too_short', msg.content.length);
        return false;
      }
      
      // Check for suspicious patterns
      if (this.containsSuspiciousContent(msg.content)) {
        this.logValidationError('suspicious_content', msg.content.substring(0, 100));
        return false;
      }
    }

    return true;
  }

  // Validate service type
  validateServiceType(serviceType) {
    if (!serviceType) return false;
    return CONFIG.validation.allowedServiceTypes.includes(serviceType);
  }

  // Check for suspicious content patterns
  containsSuspiciousContent(content) {
    const suspiciousPatterns = [
      /<script/i,
      /javascript:/i,
      /data:text\/html/i,
      /vbscript:/i,
      /on\w+\s*=/i,
      /document\.cookie/i,
      /localStorage/i,
      /sessionStorage/i,
      /eval\(/i,
      /Function\(/i
    ];
    
    return suspiciousPatterns.some(pattern => pattern.test(content));
  }

  // Generate secure response headers
  getSecureHeaders(origin = '') {
    const isAllowedOrigin = this.validateOrigin(origin);
    
    return {
      'Access-Control-Allow-Origin': isAllowedOrigin ? origin : 'null',
      'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Credentials': 'false',
      'Access-Control-Max-Age': '86400',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Robots-Tag': 'noindex, nofollow'
    };
  }

  // Security event logging
  logSecurityEvent(event, ip, details = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      ip: this.hashIP(ip),
      details: CONFIG.security.detailedLogging ? details : {}
    };
    
    console.log(`[SECURITY] ${event}:`, logEntry);
    
    // Track suspicious activity
    const hashedIP = this.hashIP(ip);
    if (!this.suspiciousActivity.has(hashedIP)) {
      this.suspiciousActivity.set(hashedIP, []);
    }
    
    this.suspiciousActivity.get(hashedIP).push({
      event,
      timestamp: Date.now(),
      details
    });
  }

  // Log validation errors
  logValidationError(type, details = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'VALIDATION_ERROR',
      validationError: type,
      details: CONFIG.security.detailedLogging ? details : null
    };
    
    console.warn('[VALIDATION]', logEntry);
  }

  // Cleanup old rate limit and suspicious activity records
  startCleanupInterval() {
    setInterval(() => {
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      
      // Cleanup rate limits
      for (const [key, timestamps] of this.rateLimit.entries()) {
        const validTimestamps = timestamps.filter(time => now - time < maxAge);
        if (validTimestamps.length === 0) {
          this.rateLimit.delete(key);
        } else {
          this.rateLimit.set(key, validTimestamps);
        }
      }
      
      // Cleanup suspicious activity
      for (const [key, activities] of this.suspiciousActivity.entries()) {
        const validActivities = activities.filter(activity => now - activity.timestamp < maxAge);
        if (validActivities.length === 0) {
          this.suspiciousActivity.delete(key);
        } else {
          this.suspiciousActivity.set(key, validActivities);
        }
      }
    }, 60 * 60 * 1000); // Run every hour
  }
}

// --- 5. OPENAI INTEGRATION ---

async function getAIResponseFromOpenAI(messages, serviceType = 'personality') {
  const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
  
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key is not configured');
  }

  // Debug logging
  console.log(`🔍 SERVICE TYPE RECEIVED: ${serviceType}`);
  
  // Select the appropriate system prompt based on service type
  const systemPrompt = serviceType === 'conflict' ? CONFLICT_RESOLUTION_PROMPT : MBTI_PERSONALITY_PROMPT;
  
  console.log(`🔍 SELECTED PROMPT: ${serviceType === 'conflict' ? 'CONFLICT_RESOLUTION' : 'PERSONALITY_ANALYSIS'}`);
  console.log(`🔍 PROMPT LENGTH: ${systemPrompt.length}`);

  const requestBody = {
    model: CONFIG.openai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    temperature: CONFIG.openai.temperature,
    max_tokens: CONFIG.openai.maxTokens,
  };

  // Only use JSON mode for personality analysis
  if (serviceType === 'personality') {
    requestBody.response_format = { type: "json_object" };
    console.log('🔍 USING JSON MODE for personality analysis');
  } else {
    console.log('🔍 USING TEXT MODE for conflict resolution');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.openai.timeout);

  try {
    console.log(`🚀 Sending ${serviceType} request to OpenAI with model: ${CONFIG.openai.model}...`);
    
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'User-Agent': 'MindMapperAI/2.0'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('❌ OpenAI API Error:', response.status, errorBody);
      
      // Handle specific error types
      if (response.status === 429) {
        throw new Error('OpenAI rate limit exceeded. Please try again later.');
      } else if (response.status === 401) {
        throw new Error('OpenAI authentication failed.');
      } else if (response.status >= 500) {
        throw new Error('OpenAI service temporarily unavailable.');
      } else {
        throw new Error(`OpenAI API request failed with status ${response.status}`);
      }
    }

    const jsonResponse = await response.json();
    
    if (!jsonResponse.choices || !jsonResponse.choices[0] || !jsonResponse.choices[0].message) {
      throw new Error('Invalid response format from OpenAI');
    }
    
    const aiContent = jsonResponse.choices[0].message.content;
    
    console.log(`🔍 RAW AI RESPONSE (first 200 chars): ${aiContent.substring(0, 200)}...`);
    
    // Validate that the response is valid JSON for personality analysis only
    if (serviceType === 'personality') {
      try {
        JSON.parse(aiContent);
        console.log('✅ Valid JSON response received for personality analysis');
      } catch (parseError) {
        console.error('❌ OpenAI returned invalid JSON for personality analysis:', aiContent.substring(0, 200));
        throw new Error('AI response format error');
      }
    } else {
      // For conflict resolution, ensure it's NOT JSON
      if (aiContent.trim().startsWith('{') && aiContent.includes('ready_for_analysis')) {
        console.error('❌ OpenAI returned JSON for conflict resolution when it should be text');
        throw new Error('AI returned wrong response format for conflict resolution');
      }
      console.log('✅ Text response received for conflict resolution');
    }

    console.log(`✅ Successfully received and validated ${serviceType} AI response`);
    return aiContent;

  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error('Request to OpenAI timed out. Please try again.');
    }
    
    console.error('💥 OpenAI request error:', error.message);
    
    // Return service-specific fallback error messages
    if (serviceType === 'conflict') {
      return "I'm experiencing a temporary connection issue. Could you please describe your conflict situation again? I want to make sure I can help you find the best resolution.";
    } else {
      // Personality analysis fallback (JSON format)
      return JSON.stringify({
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
    }
  }
}

// --- 6. DATABASE OPERATIONS ---

async function saveConversationToDatabase(messages, aiResponse, securityContext, serviceType = 'personality') {
  if (!supabaseClient) {
    console.warn('⚠️ Supabase not initialized, skipping database save');
    return Date.now(); // Return fallback ID
  }

  try {
    const conversationHistory = [
      ...messages,
      { role: 'assistant', content: aiResponse }
    ];

    const conversationData = {
      conversation_history: conversationHistory,
      service_type: serviceType,
      client_ip_hash: securityContext.ipHash,
      user_agent_hash: securityContext.userAgentHash,
      request_timestamp: new Date().toISOString(),
      message_count: messages.length,
      final_analysis: securityContext.isFinalAnalysis || false,
      language: securityContext.language || 'en',
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabaseClient
      .from('conversations')
      .insert(conversationData)
      .select('id')
      .single();

    if (error) {
      console.error('❌ Database insert error:', error.message);
      // Don't throw error to avoid breaking the user experience
      return Date.now(); // Return fallback ID
    }

    if (data && data.id) {
      console.log(`✅ ${serviceType} conversation saved to database with ID: ${data.id}`);
      return data.id;
    } else {
      console.warn('⚠️ Database insert returned no ID');
      return Date.now();
    }

  } catch (error) {
    console.error('💥 Database save error:', error.message);
    return Date.now(); // Return fallback ID
  }
}

// --- 7. MAIN HANDLER FUNCTION ---

const securityManager = new SecurityManager();

exports.handler = async (event) => {
  const startTime = Date.now();
  const origin = event.headers?.origin || '';
  const ip = securityManager.getClientIP(event);
  const userAgent = event.headers?.['user-agent'] || '';
  const secureHeaders = securityManager.getSecureHeaders(origin);

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

  // Check rate limiting
  const rateLimitPassed = await securityManager.checkRateLimit(ip, 'chat');
  if (!rateLimitPassed) {
    return {
      statusCode: 429,
      headers: {
        ...secureHeaders,
        'Retry-After': '60',
        'X-Rate-Limit-Limit': CONFIG.rateLimits.chat.requests.toString(),
        'X-Rate-Limit-Window': CONFIG.rateLimits.chat.windowMs.toString()
      },
      body: JSON.stringify({
        error: 'Too many requests. Please try again in a minute.',
        retryAfter: 60
      })
    };
  }

  // Validate required environment variables
  if (!process.env.OPENAI_API_KEY) {
    await securityManager.logSecurityEvent('MISSING_API_KEY', ip);
    return {
      statusCode: 500,
      headers: secureHeaders,
      body: JSON.stringify({ error: 'Service temporarily unavailable' })
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

    const { messages, service_type = 'personality' } = body;

    console.log(`🔍 REQUEST RECEIVED: service_type = ${service_type}`);

    // Validate service type
    if (!securityManager.validateServiceType(service_type)) {
      await securityManager.logSecurityEvent('INVALID_SERVICE_TYPE', ip, {
        service_type
      });
      return {
        statusCode: 400,
        headers: secureHeaders,
        body: JSON.stringify({
          error: 'Invalid service type. Must be "personality" or "conflict".',
          allowed_types: CONFIG.validation.allowedServiceTypes
        })
      };
    }

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

    console.log(`🔥 Processing ${sanitizedMessages.length} ${service_type} messages from ${securityManager.hashIP(ip)}`);

    // Get AI response
    const aiResponse = await getAIResponseFromOpenAI(sanitizedMessages, service_type);

    console.log(`🔍 AI RESPONSE RECEIVED for ${service_type}: ${aiResponse.substring(0, 100)}...`);

    // Determine if this is a final analysis (only for personality service)
    let isFinalAnalysis = false;
    if (service_type === 'personality') {
      try {
        const aiData = JSON.parse(aiResponse);
        isFinalAnalysis = aiData.ready_for_analysis === true;
        console.log(`🔍 PERSONALITY ANALYSIS: ready_for_analysis = ${isFinalAnalysis}`);
      } catch (e) {
        console.log('🔍 Could not parse personality response as JSON, treating as ongoing');
        // If parsing fails, it's not a final analysis
      }
    }

    // Prepare security context for database save
    const securityContext = {
      ipHash: securityManager.hashIP(ip),
      userAgentHash: crypto.createHash('sha256').update(userAgent + CONFIG.security.hashSalt).digest('hex').substring(0, 16),
      isFinalAnalysis,
      language: body.language || 'en'
    };

    // Save to database
    const conversationId = await saveConversationToDatabase(
      sanitizedMessages,
      aiResponse,
      securityContext,
      service_type
    );

    // Log successful completion
    const processingTime = Date.now() - startTime;
    console.log(`✅ ${service_type} request completed in ${processingTime}ms for conversation ${conversationId}`);

    // Log performance metrics
    if (processingTime > 10000) { // Log slow requests (>10s)
      console.warn(`⚠️ Slow ${service_type} request detected: ${processingTime}ms`);
    }

    return {
      statusCode: 200,
      headers: {
        ...secureHeaders,
        'Content-Type': 'application/json',
        'X-Response-Time': processingTime.toString(),
        'X-Service-Type': service_type
      },
      body: JSON.stringify({
        reply: aiResponse,
        conversation_id: conversationId,
        service_type: service_type,
        processing_time: processingTime
      })
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    await securityManager.logSecurityEvent('PROCESSING_ERROR', ip, {
      error: error.message,
      processingTime
    });

    console.error('💥 Unhandled error in handler function:', error);

    return {
      statusCode: 500,
      headers: secureHeaders,
      body: JSON.stringify({
        error: 'An error occurred while processing your request',
        requestId: Date.now().toString() // Help with support requests
      })
    };
  }
};