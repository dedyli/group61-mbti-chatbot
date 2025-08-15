// netlify/functions/mbti-chat.js - Simple working ChatGPT-4 MBTI

exports.handler = async (event, context) => {
  console.log('🚀 MBTI Chat function started');
  
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }
  
  try {
    // Check API key
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('OpenRouter API key not found');
    }
    
    // Parse request
    let requestData;
    try {
      requestData = JSON.parse(event.body || '{}');
    } catch (e) {
      throw new Error('Invalid JSON in request body');
    }
    
    const { messages = [] } = requestData;
    console.log(`Processing ${messages.length} messages`);
    
    // Simple system prompt that works
    const systemPrompt = `You are an MBTI personality analyst. Have a natural conversation to determine someone's MBTI type.

Rules:
1. Ask 5-7 questions total about: energy source, learning style, decision-making, and planning preferences
2. Always respond with ONLY valid JSON in this exact format:
{
  "message": "your question or analysis",
  "type": "ENFP or null",
  "confidence": 0.75,
  "ready": false,
  "progress": 2
}
3. Set ready:true and provide type when you have enough information
4. Be conversational and friendly
5. NO markdown formatting, just plain JSON

Start with a question about energy/recharging.`;

    // Prepare messages for API
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];
    
    // Call OpenRouter API
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://group61project.netlify.app/',
        'X-Title': 'Mind-Mapper AI'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: apiMessages,
        max_tokens: 200,
        temperature: 0.7
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error:', errorText);
      throw new Error(`API error: ${response.status}`);
    }
    
    const apiData = await response.json();
    console.log('API response received');
    
    if (!apiData.choices?.[0]?.message?.content) {
      throw new Error('Invalid API response structure');
    }
    
    let content = apiData.choices[0].message.content.trim();
    
    // Clean up response
    content = content.replace(/```json\s*|\s*```/g, '').trim();
    
    // Parse JSON response
    let result;
    try {
      result = JSON.parse(content);
    } catch (e) {
      console.log('JSON parse failed, creating fallback response');
      // Fallback if JSON parsing fails
      const messageCount = messages.filter(m => m.role === 'user').length;
      result = {
        message: messageCount === 0 
          ? "Hi! I'll help you discover your MBTI type. After a busy day, what helps you recharge - being around people or having quiet time alone?"
          : "That's interesting! Can you tell me more about how you prefer to make important decisions?",
        type: null,
        confidence: 0.0,
        ready: false,
        progress: Math.min(messageCount + 1, 5)
      };
    }
    
    // Validate and ensure required fields
    if (!result.message) result.message = "Can you tell me more about that?";
    if (typeof result.ready !== 'boolean') result.ready = false;
    if (typeof result.progress !== 'number') result.progress = 1;
    if (typeof result.confidence !== 'number') result.confidence = 0.0;
    
    console.log('✅ Returning result:', { ready: result.ready, progress: result.progress });
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
    
  } catch (error) {
    console.error('💥 Function error:', error);
    
    // Return fallback response instead of error
    const fallbackResponse = {
      message: "Hi there! I'm here to help you discover your MBTI personality type. Let's start with a simple question: After a busy day, what helps you recharge your energy - spending time with friends or having some quiet time alone?",
      type: null,
      confidence: 0.0,
      ready: false,
      progress: 1
    };
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(fallbackResponse)
    };
  }
};