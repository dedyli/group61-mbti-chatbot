// netlify/functions/admin-analytics.js - Clean version with no extra env vars

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase admin client (uses existing env vars)
let supabaseAdmin = null;

if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

// Verify JWT token using the admin client
async function verifyJWTToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ') || !supabaseAdmin) {
    return null;
  }
  
  const token = authHeader.substring(7);
  
  try {
    // Use the admin client to verify the JWT token
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    
    if (error || !user) {
      console.log('JWT verification failed:', error?.message);
      return null;
    }
    
    console.log('Authenticated user:', user.email);
    return user;
    
  } catch (error) {
    console.error('JWT verification error:', error);
    return null;
  }
}

function getSecureHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  };
}

exports.handler = async (event) => {
  const headers = getSecureHeaders();

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Verify authentication
  const user = await verifyJWTToken(event.headers.authorization);
  if (!user) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized - Please login with valid Supabase credentials' })
    };
  }

  // Check if admin services are available
  if (!supabaseAdmin) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ error: 'Admin service unavailable' })
    };
  }

  try {
    const { action } = JSON.parse(event.body || '{}');

    switch (action) {
      case 'overview_stats':
        return await getOverviewStats(headers, user);
      
      case 'conversations':
        return await getConversations(headers, event, user);
      
      case 'feedback':
        return await getFeedback(headers, user);
      
      case 'contacts':
        return await getContacts(headers, event, user);
      
      case 'mbti_analysis':
        return await getMBTIAnalysis(headers, user);
      
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' })
        };
    }

  } catch (error) {
    console.error('Admin API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function getOverviewStats(headers, user) {
  try {
    console.log(`Loading overview stats for user: ${user.email}`);
    
    // Get conversation stats
    const { count: totalConversations, error: convoError } = await supabaseAdmin
      .from('conversations')
      .select('*', { count: 'exact', head: true });

    if (convoError) throw convoError;

    // Get unique users (based on IP hash)
    const { data: uniqueIPs, error: userError } = await supabaseAdmin
      .from('conversations')
      .select('client_ip_hash')
      .not('client_ip_hash', 'is', null);

    if (userError) throw userError;

    const uniqueUsers = new Set(uniqueIPs?.map(u => u.client_ip_hash)).size;

    // Get completion rate
    const { count: completedAnalyses, error: completedError } = await supabaseAdmin
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('final_analysis', true);

    if (completedError) throw completedError;

    // Get feedback stats
    const { data: feedbackData, error: feedbackError } = await supabaseAdmin
      .from('feedback')
      .select('is_accurate');

    if (feedbackError) throw feedbackError;

    let accuracyRate = 'N/A';
    if (feedbackData && feedbackData.length > 0) {
      const accurate = feedbackData.filter(f => f.is_accurate).length;
      accuracyRate = Math.round((accurate / feedbackData.length) * 100) + '%';
    }

    // Calculate average conversation length
    const { data: conversationLengths, error: lengthError } = await supabaseAdmin
      .from('conversations')
      .select('message_count')
      .not('message_count', 'is', null);

    if (lengthError) throw lengthError;

    let avgLength = '0';
    if (conversationLengths && conversationLengths.length > 0) {
      const totalMessages = conversationLengths.reduce((sum, c) => sum + (c.message_count || 0), 0);
      avgLength = (totalMessages / conversationLengths.length).toFixed(1);
    }

    const stats = {
      totalUsers: uniqueUsers || 0,
      totalConversations: totalConversations || 0,
      completedAnalyses: completedAnalyses || 0,
      accuracyRate,
      avgConversationLength: avgLength,
      completionRate: totalConversations > 0 ? 
        Math.round((completedAnalyses / totalConversations) * 100) + '%' : '0%'
    };

    console.log('Overview stats:', stats);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: stats })
    };

  } catch (error) {
    console.error('Overview stats error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch overview stats' })
    };
  }
}

async function getConversations(headers, event, user) {
  try {
    const { limit = 20, offset = 0 } = JSON.parse(event.body || '{}');

    const { data: conversations, error } = await supabaseAdmin
      .from('conversations')
      .select('id, created_at, message_count, final_analysis, language, client_ip_hash')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: conversations || [] })
    };

  } catch (error) {
    console.error('Conversations error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch conversations' })
    };
  }
}

async function getFeedback(headers, user) {
  try {
    const { data: feedback, error } = await supabaseAdmin
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const stats = {
      total: feedback?.length || 0,
      positive: feedback?.filter(f => f.is_accurate).length || 0,
      negative: feedback?.filter(f => !f.is_accurate).length || 0
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        data: feedback || [], 
        stats 
      })
    };

  } catch (error) {
    console.error('Feedback error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch feedback' })
    };
  }
}

async function getContacts(headers, event, user) {
  try {
    const { limit = 50, offset = 0, search = '' } = JSON.parse(event.body || '{}');

    let query = supabaseAdmin
      .from('contact_messages')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (search.trim()) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,message.ilike.%${search}%`);
    }

    const { data: contacts, count, error } = await query
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        data: contacts || [], 
        total: count || 0 
      })
    };

  } catch (error) {
    console.error('Contacts error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch contacts' })
    };
  }
}

async function getMBTIAnalysis(headers, user) {
  try {
    // For now, return mock data based on actual conversation count
    const { count: totalConversations } = await supabaseAdmin
      .from('conversations')
      .select('*', { count: 'exact', head: true });

    // Generate proportional mock data based on actual usage
    const baseMultiplier = Math.max(1, Math.floor((totalConversations || 0) / 16));
    
    const mbtiData = {
      'INTJ': 3 * baseMultiplier, 'INTP': 2 * baseMultiplier, 'ENTJ': 1 * baseMultiplier, 'ENTP': 4 * baseMultiplier,
      'INFJ': 5 * baseMultiplier, 'INFP': 6 * baseMultiplier, 'ENFJ': 3 * baseMultiplier, 'ENFP': 7 * baseMultiplier,
      'ISTJ': 2 * baseMultiplier, 'ISFJ': 2 * baseMultiplier, 'ESTJ': 1 * baseMultiplier, 'ESFJ': 2 * baseMultiplier,
      'ISTP': 1 * baseMultiplier, 'ISFP': 2 * baseMultiplier, 'ESTP': 1 * baseMultiplier, 'ESFP': 3 * baseMultiplier
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: mbtiData })
    };

  } catch (error) {
    console.error('MBTI analysis error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch MBTI analysis' })
    };
  }
}