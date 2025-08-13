// Server-side proxy to OpenRouter (hides your API key)
export async function handler(event, context) {
  const ORIGIN = event.headers.origin || '';
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
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return { statusCode: 500, body: 'Missing OPENROUTER_API_KEY' };
  }

  try {
    const body = event.body || '{}';

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        // (Optional but recommended by OpenRouter)
        'HTTP-Referer': event.headers.referer || 'https://your-site.netlify.app',
        'X-Title': 'Mind-Mapper AI',
      },
      body,
    });

    const text = await resp.text();
    return {
      statusCode: resp.status,
      headers: {
        'Content-Type': 'application/json',
        // same-origin is fine since function shares the site origin;
        // keeping permissive if you ever embed elsewhere:
        'Access-Control-Allow-Origin': ORIGIN || '*',
      },
      body: text,
    };
  } catch (err) {
    return { statusCode: 502, body: `Proxy error: ${err.message}` };
  }
}
