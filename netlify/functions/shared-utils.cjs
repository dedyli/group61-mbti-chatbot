// shared-utils.cjs - Shared functionality for Mind-Mapper AI services

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Shared configuration
const CONFIG = {
  // Allowed origins (CRITICAL: Update these to your actual domains)
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:8080').split(','),
  
  // Input validation rules
  validation: {
    maxMessageLength: 2000,
    maxMessagesPerConversation: 50,
    maxContactMessageLength: 5000,
    allowedLanguages: ['en', 'vi', 'zh'],
    minMessageLength: 1
  },
  
  // OpenAI configuration
  openai: {
    model: "gpt-4o",
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

// Initialize Supabase client
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

// Initialize on module load
const supabaseInitialized = initializeSupabase();

// Shared Security Manager
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
  async checkRateLimit(ip, requests, windowMs) {
    const hashedIP = this.hashIP(ip);
    const now = Date.now();
    
    // Get or create rate limit record
    if (!this.rateLimit.has(hashedIP)) {
      this.rateLimit.set(hashedIP, []);
    }
    
    const timestamps = this.rateLimit.get(hashedIP);
    
    // Remove expired timestamps
    const validTimestamps = timestamps.filter(time => now - time < windowMs);
    
    // Check if limit exceeded
    if (validTimestamps.length >= requests) {
      this.logSecurityEvent('RATE_LIMIT_EXCEEDED', ip, { 
        requestCount: validTimestamps.length,
        limit: requests 
      });
      return false;
    }
    
    // Add current timestamp
    validTimestamps.push(now);
    this.rateLimit.set(hashedIP, validTimestamps);
    
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

// Shared OpenAI integration
async function callOpenAI(messages, systemPrompt, serviceType) {
  const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
  
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key is not configured');
  }

  console.log(`🔍 SERVICE TYPE: ${serviceType}`);
  console.log(`🔍 PROMPT LENGTH: ${systemPrompt.length}`);

  const requestBody = {
    model: CONFIG.openai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    temperature: CONFIG.openai.temperature,
    max_tokens: CONFIG.openai.maxTokens,
    response_format: { type: "json_object" }
  };

  console.log('🔍 USING JSON MODE');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.openai.timeout);

  try {
    console.log(`🚀 Calling OpenAI for ${serviceType}...`);
    
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
    
    // Validate JSON
    try {
      JSON.parse(aiContent);
      console.log(`✅ Valid JSON response received for ${serviceType}`);
    } catch (parseError) {
      console.error(`❌ OpenAI returned invalid JSON for ${serviceType}:`, aiContent.substring(0, 200));
      throw new Error('AI response format error');
    }

    console.log(`✅ Successfully received and validated ${serviceType} AI response`);
    return aiContent;

  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error('Request to OpenAI timed out. Please try again.');
    }
    
    console.error('💥 OpenAI request error:', error.message);
    throw error;
  }
}

// Shared database operations
async function saveConversation(messages, aiResponse, securityContext, serviceType) {
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

// Export all shared utilities
module.exports = {
  CONFIG,
  SecurityManager,
  callOpenAI,
  saveConversation
};