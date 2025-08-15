// netlify/functions/save-feedback.js
const { createClient } = require('@supabase/supabase-js');

function cors() {
  // If you prefer, replace * with your site origin:
  // 'Access-Control-Allow-Origin': 'https://group61project.netlify.app'
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors(), body: 'Method Not Allowed' };
  }

  try {
    const { conversation_id, is_accurate } = JSON.parse(event.body || '{}');

    if (!conversation_id || typeof is_accurate !== 'boolean') {
      return {
        statusCode: 400,
        headers: cors(),
        body: 'Invalid payload: require { conversation_id, is_accurate:boolean }',
      };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { error } = await supabase.from('feedback').insert({
      conversation_id: Number(conversation_id),
      is_accurate,
      created_at: new Date().toISOString(),
    });

    if (error) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify(error) };
    }

    return { statusCode: 201, headers: cors(), body: '{}' };
  } catch (e) {
    return { statusCode: 500, headers: cors(), body: e.message || String(e) };
  }
};
