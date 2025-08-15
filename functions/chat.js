// netlify/functions/chat.js
exports.handler = async (event, context) => {
  const ORIGIN = event.headers.origin || event.headers.Origin || '';
  
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': ORIGIN || '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers: {
        'Access-Control-Allow-Origin': ORIGIN || '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return { 
      statusCode: 500, 
      headers: {
        'Access-Control-Allow-Origin': ORIGIN || '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Missing OPENROUTER_API_KEY' })
    };
  }

  try {
    const body = event.body || '{}';
    
    console.log('Forwarding request to OpenRouter...');

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': event.headers.referer || 'https://your-site.netlify.app',
        'X-Title': 'Mind-Mapper AI',
      },
      body,
    });

    const text = await resp.text();
    
    console.log('OpenRouter response status:', resp.status);
    console.log('OpenRouter response:', text.substring(0, 200) + '...');

    return {
      statusCode: resp.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': ORIGIN || '*',
        'Access-Control-Allow-Credentials': 'false',
      },
      body: text,
    };
  } catch (err) {
    console.error('Function error:', err);
    return { 
      statusCode: 502, 
      headers: {
        'Access-Control-Allow-Origin': ORIGIN || '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: `Proxy error: ${err.message}` })
    };
  }
};