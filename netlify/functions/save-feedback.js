// save-feedback.js - Secure feedback handling function
// Companion to the secure process-chat.js

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Configuration
const CONFIG = {
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:8080').split(','),
  rateLimits: {
    feedback: { requests: 5, windowMs: 60000 } // 5 feedback submissions per minute
  },
  security: {
    hashSalt: process.env.HASH_SALT || 'mindmapper-secure-salt-2024',
    maxRequestSize: 1024, // 1KB should be enough for feedback
  }
};

// Initialize Supabase
let supabaseClient = null;
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
  } catch (error) {
    console.error('❌ Failed to initialize Supabase client:', error.message);
  }
}

// Security utilities
const SecurityUtils = {
  getClientIP(event) {
    const headers = event.headers || {};
    const forwarded = headers['x-forwarded-for'];
    const realIP = headers['x-real-ip'];
    const clientIP = headers['client-ip'];
    const cfConnectingIP = headers['cf-connecting-ip'];
    
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return realIP || clientIP || cfConnectingIP || event.requestContext?.identity?.sourceIp || 'unknown';
  },

  hashIP(ip) {
    return crypto
      .createHash('sha256')
      .update(ip + CONFIG.security.hashSalt)
      .digest('hex')
      .substring(0, 16);
  },

  validateOrigin(origin) {
    if (!origin) return false;
    
    if (process.env.NODE_ENV === 'development') {
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        return true;
      }
    }
    
    return CONFIG.allowedOrigins.includes(origin);
  },

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
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache'
    };
  },

  logSecurityEvent(event, ip, details = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      ip: this.hashIP(ip),
      details: process.env.NODE_ENV !== 'production' ? details : {}
    };
    
    console.log(`[FEEDBACK-SECURITY] ${event}:`, logEntry);
  }
};

// Simple in-memory rate limiting for feedback
const feedbackRateLimit = new Map();

async function checkFeedbackRateLimit(ip) {
  const hashedIP = SecurityUtils.hashIP(ip);
  const limit = CONFIG.rateLimits.feedback;
  const now = Date.now();
  
  if (!feedbackRateLimit.has(hashedIP)) {
    feedbackRateLimit.set(hashedIP, []);
  }
  
  const timestamps = feedbackRateLimit.get(hashedIP);
  const validTimestamps = timestamps.filter(time => now - time < limit.windowMs);
  
  if (validTimestamps.length >= limit.requests) {
    SecurityUtils.logSecurityEvent('FEEDBACK_RATE_LIMIT_EXCEEDED', ip, {
      requestCount: validTimestamps.length,
      limit: limit.requests
    });
    return false;
  }
  
  validTimestamps.push(now);
  feedbackRateLimit.set(hashedIP, validTimestamps);
  return true;
}

// Validation functions
function validateFeedbackData(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid data format' };
  }

  const { conversation_id, is_accurate } = data;

  // Validate conversation_id
  if (conversation_id === undefined || conversation_id === null) {
    return { valid: false, error: 'Missing conversation_id' };
  }

  // Convert to number and validate
  const numericId = Number(conversation_id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return { valid: false, error: 'Invalid conversation_id format' };
  }

  // Validate is_accurate
  if (typeof is_accurate !== 'boolean') {
    return { valid: false, error: 'Invalid is_accurate value - must be boolean' };
  }

  return { 
    valid: true, 
    data: { 
      conversation_id: numericId, 
      is_accurate 
    } 
  };
}

// Main handler function
exports.handler = async (event) => {
  const startTime = Date.now();
  const origin = event.headers?.origin || '';
  const ip = SecurityUtils.getClientIP(event);
  const secureHeaders = SecurityUtils.getSecureHeaders(origin);

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
    SecurityUtils.logSecurityEvent('INVALID_METHOD', ip, {
      method: event.httpMethod
    });
    return {
      statusCode: 405,
      headers: secureHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Validate origin
  if (!SecurityUtils.validateOrigin(origin)) {
    SecurityUtils.logSecurityEvent('INVALID_ORIGIN', ip, { origin });
    return {
      statusCode: 403,
      headers: secureHeaders,
      body: JSON.stringify({ error: 'Origin not allowed' })
    };
  }

  // Check rate limiting
  const rateLimitPassed = await checkFeedbackRateLimit(ip);
  if (!rateLimitPassed) {
    return {
      statusCode: 429,
      headers: {
        ...secureHeaders,
        'Retry-After': '60'
      },
      body: JSON.stringify({
        error: 'Too many feedback submissions. Please try again later.',
        retryAfter: 60
      })
    };
  }

  // Check request size
  const requestSize = Buffer.byteLength(event.body || '{}');
  if (requestSize > CONFIG.security.maxRequestSize) {
    SecurityUtils.logSecurityEvent('REQUEST_TOO_LARGE', ip, {
      size: requestSize
    });
    return {
      statusCode: 413,
      headers: secureHeaders,
      body: JSON.stringify({ error: 'Request too large' })
    };
  }

  // Check if Supabase is available
  if (!supabaseClient) {
    SecurityUtils.logSecurityEvent('DATABASE_UNAVAILABLE', ip);
    return {
      statusCode: 503,
      headers: secureHeaders,
      body: JSON.stringify({ error: 'Service temporarily unavailable' })
    };
  }

  try {
    // Parse request body
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (parseError) {
      SecurityUtils.logSecurityEvent('INVALID_JSON', ip, {
        error: parseError.message
      });
      return {
        statusCode: 400,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'Invalid JSON format' })
      };
    }

    // Validate feedback data
    const validation = validateFeedbackData(body);
    if (!validation.valid) {
      SecurityUtils.logSecurityEvent('INVALID_FEEDBACK_DATA', ip, {
        error: validation.error
      });
      return {
        statusCode: 400,
        headers: secureHeaders,
        body: JSON.stringify({ error: validation.error })
      };
    }

    const { conversation_id, is_accurate } = validation.data;

    console.log(`📝 Processing feedback for conversation ${conversation_id}: ${is_accurate ? 'accurate' : 'not accurate'}`);

    // Verify conversation exists (optional security check)
    const { data: conversationExists, error: checkError } = await supabaseClient
      .from('conversations')
      .select('id')
      .eq('id', conversation_id)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('❌ Error checking conversation existence:', checkError.message);
      return {
        statusCode: 500,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'Database error occurred' })
      };
    }

    if (!conversationExists) {
      SecurityUtils.logSecurityEvent('INVALID_CONVERSATION_ID', ip, {
        conversation_id
      });
      return {
        statusCode: 404,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'Conversation not found' })
      };
    }

    // Save feedback to database
    const feedbackData = {
      conversation_id,
      is_accurate,
      ip_hash: SecurityUtils.hashIP(ip),
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabaseClient
      .from('feedback')
      .insert(feedbackData)
      .select('id')
      .single();

    if (error) {
      console.error('❌ Database insert error:', error.message);
      SecurityUtils.logSecurityEvent('DATABASE_INSERT_ERROR', ip, {
        error: error.message,
        conversation_id
      });
      return {
        statusCode: 500,
        headers: secureHeaders,
        body: JSON.stringify({ error: 'Failed to save feedback' })
      };
    }

    const processingTime = Date.now() - startTime;
    console.log(`✅ Feedback saved successfully with ID: ${data.id} (${processingTime}ms)`);

    return {
      statusCode: 200,
      headers: {
        ...secureHeaders,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: 'Feedback saved successfully',
        feedback_id: data.id
      })
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    SecurityUtils.logSecurityEvent('PROCESSING_ERROR', ip, {
      error: error.message,
      processingTime
    });

    console.error('💥 Unhandled error in feedback handler:', error);

    return {
      statusCode: 500,
      headers: secureHeaders,
      body: JSON.stringify({
        error: 'An error occurred while processing your feedback',
        requestId: Date.now().toString()
      })
    };
  }
};

// Cleanup old rate limit records periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 hour
  
  for (const [key, timestamps] of feedbackRateLimit.entries()) {
    const validTimestamps = timestamps.filter(time => now - time < maxAge);
    if (validTimestamps.length === 0) {
      feedbackRateLimit.delete(key);
    } else {
      feedbackRateLimit.set(key, validTimestamps);
    }
  }
}, 60 * 60 * 1000); // Run cleanup every hour