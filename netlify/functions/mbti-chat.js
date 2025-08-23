// netlify/functions/mbti-chat.js - ChatGLM-4.5 Free MBTI Chatbot

exports.handler = async (event, context) => {
  console.log('🚀 MBTI Chat function started with ChatGLM-4.5');
  
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
    console.log(`Processing ${messages.length} messages with ChatGLM-4.5`);
    
    // Optimized system prompt for ChatGLM-4.5
    const systemPrompt = `You are an MBTI personality analyst. Your job is to determine someone's Myers-Briggs personality type through conversation.

CONVERSATION RULES:
1. Ask 5-7 questions total about: energy source (E/I), information processing (S/N), decision-making (T/F), and planning style (J/P)
2. ALWAYS respond with ONLY valid JSON in this exact format:
{
  "message": "your conversational question or analysis here",
  "type": "ENFP",
  "confidence": 0.8,
  "ready": false,
  "progress": 3
}
3. Set "ready": true and provide "type" when you have enough information (after 5-7 exchanges)
4. Be friendly and natural in your questions
5. NO markdown formatting in JSON - just plain text
6. Progress should be 1-5 (1=start, 5=complete)

MBTI TYPES TO CHOOSE FROM:
INTJ, INTP, ENTJ, ENTP, INFJ, INFP, ENFJ, ENFP, ISTJ, ISFJ, ESTJ, ESFJ, ISTP, ISFP, ESTP, ESFP

For first message, ask about energy/recharging. For continuing, ask follow-up questions about learning style, decision-making, or planning preferences.

Return ONLY the JSON response, no other text.`;

    // Prepare messages for API
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];
    
    // Call OpenRouter API with ChatGLM-4.5 (FREE model)
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://group61project.netlify.app/',
        'X-Title': 'Mind-Mapper AI'
      },
      body: JSON.stringify({
        model: 'zhipuai/glm-4-9b-chat', // ChatGLM-4.5 free model
        messages: apiMessages,
        max_tokens: 250,
        temperature: 0.7
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error:', errorText);
      throw new Error(`API error: ${response.status}`);
    }
    
    const apiData = await response.json();
    console.log('ChatGLM-4.5 response received');
    
    if (!apiData.choices?.[0]?.message?.content) {
      throw new Error('Invalid API response structure');
    }
    
    let content = apiData.choices[0].message.content.trim();
    
    // Clean up response - ChatGLM sometimes adds extra formatting
    content = content.replace(/```json\s*|\s*```/g, '').trim();
    content = content.replace(/^[^{]*({.*})[^}]*$/s, '$1'); // Extract JSON from any surrounding text
    
    // Parse JSON response
    let result;
    try {
      result = JSON.parse(content);
      console.log('Successfully parsed ChatGLM-4.5 response');
    } catch (e) {
      console.log('JSON parse failed, creating smart fallback response');
      
      // Smart fallback based on conversation length
      const userMessages = messages.filter(m => m.role === 'user');
      const messageCount = userMessages.length;
      
      if (messageCount === 0) {
        result = {
          message: "Hi! I'll help you discover your MBTI personality type through a friendly conversation. Let's start: After a busy day, what helps you recharge your energy - spending time with friends or having some quiet time alone?",
          type: null,
          confidence: 0.0,
          ready: false,
          progress: 1
        };
      } else if (messageCount <= 2) {
        result = {
          message: "That's interesting! Now I'm curious about how you prefer to learn new things. Do you like detailed step-by-step instructions, or do you prefer to explore and figure things out yourself?",
          type: null,
          confidence: 0.0,
          ready: false,
          progress: 2
        };
      } else if (messageCount <= 4) {
        result = {
          message: "Great! One more area I'd like to explore: When making important decisions, what do you rely on more - logical analysis of facts and outcomes, or considering how it will affect people and relationships?",
          type: null,
          confidence: 0.0,
          ready: false,
          progress: 4
        };
      } else {
        // Try to infer MBTI type from conversation
        const conversation = messages.map(m => m.content.toLowerCase()).join(' ');
        let inferredType = 'ENFP'; // Default fallback
        
        // Simple pattern matching
        if (conversation.includes('alone') || conversation.includes('quiet')) {
          inferredType = conversation.includes('logical') ? 'INTP' : 'INFP';
        } else if (conversation.includes('people') || conversation.includes('social')) {
          inferredType = conversation.includes('logical') ? 'ENTJ' : 'ENFP';
        }
        
        result = {
          message: `Based on our conversation, you appear to be an ${inferredType} personality type! You show characteristics of being ${inferredType.includes('I') ? 'introverted' : 'extraverted'}, ${inferredType.includes('S') ? 'sensing' : 'intuitive'}, ${inferredType.includes('T') ? 'thinking' : 'feeling'}, and ${inferredType.includes('J') ? 'judging' : 'perceiving'}. This means you likely recharge through ${inferredType.includes('I') ? 'solitude' : 'social interaction'}, prefer ${inferredType.includes('S') ? 'concrete details' : 'big picture thinking'}, make decisions based on ${inferredType.includes('T') ? 'logic' : 'values'}, and like ${inferredType.includes('J') ? 'structure' : 'flexibility'}.`,
          type: inferredType,
          confidence: 0.7,
          ready: true,
          progress: 5
        };
      }
    }
    
    // Validate and ensure required fields
    if (!result.message) result.message = "Can you tell me more about that?";
    if (typeof result.ready !== 'boolean') result.ready = false;
    if (typeof result.progress !== 'number') result.progress = Math.min(messages.filter(m => m.role === 'user').length + 1, 5);
    if (typeof result.confidence !== 'number') result.confidence = 0.0;
    
    console.log('✅ Returning result:', { 
      ready: result.ready, 
      progress: result.progress, 
      type: result.type || 'none',
      model: 'ChatGLM-4.5'
    });
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
    
  } catch (error) {
    console.error('💥 Function error:', error);
    
    // Return smart fallback response instead of error
    const userMessageCount = (JSON.parse(event.body || '{}').messages || [])
      .filter(m => m.role === 'user').length;
    
    const fallbackResponse = {
      message: userMessageCount === 0 
        ? "Hi there! I'm here to help you discover your MBTI personality type. Let's start with a simple question: After a busy day, what helps you recharge your energy - spending time with friends or having some quiet time alone?"
        : "That's helpful to know! Can you tell me more about how you prefer to approach learning new things?",
      type: null,
      confidence: 0.0,
      ready: false,
      progress: Math.min(userMessageCount + 1, 5)
    };
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(fallbackResponse)
    };
  }
};