// netlify/functions/admin-login.js
import { serverClient } from './_utils/supabase.js';

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ success:false, message:'Method Not Allowed' }) };
    }
    const { email, password } = JSON.parse(event.body || '{}');
    if (!email || !password) {
      return { statusCode: 400, body: JSON.stringify({ success:false, message:'Email and password are required' }) };
    }

    const supabase = serverClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return { statusCode: 401, body: JSON.stringify({ success:false, message:error.message }) };
    }

    return { statusCode: 200, body: JSON.stringify({ success:true, session: data.session }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success:false, message: err.message }) };
  }
}
