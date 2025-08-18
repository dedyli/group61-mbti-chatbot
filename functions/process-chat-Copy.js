// process-chat.js - Reconstructed for Direct OpenAI Integration

const { createClient } = require('@supabase/supabase-js');

// --- 1. Environment and API Configuration ---

// Initialize Supabase client for saving conversations
// Your SUPABASE_URL and SUPABASE_SERVICE_KEY should be set in Netlify environment
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  try {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    console.log('✅ Supabase client created successfully.');
  } catch (error) {
    console.error('❌ Failed to create Supabase client:', error);
  }
} else {
  console.error('❌ Missing Supabase environment variables for database connection.');
}

// OpenAI API Configuration
// Your OPENAI_API_KEY should be set in Netlify environment
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_HEADERS = {
  'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
  'Content-Type': 'application/json',
};

// --- 2. Enhanced AI System Prompt ---

// This new prompt delegates more analytical responsibility to the LLM.
// It instructs the AI to manage the conversation flow, track progress internally,
// and provide detailed reasoning for its final analysis.
const MBTI_SYSTEM_PROMPT = `You are Mind-Mapper AI, a sophisticated and empathetic MBTI personality analyst. Your goal is to determine a user's personality type through a natural, insightful, and flowing conversation.

**Core Directives:**
1.  **Strict JSON Output:** You MUST ONLY output a single, valid JSON object without any markdown formatting (like \`\`\`json), commentary, or extra text.
2.  **Conversational Flow:** Do not be robotic. Engage the user in a warm, curious, and human-like dialogue. Build rapport before diving deep. Ask clarifying follow-up questions to understand nuance.
3.  **Holistic Analysis:** You are responsible for determining when you have sufficient information to make a confident assessment. This typically requires exploring all four MBTI dimensions, but the depth of the conversation is more important than the number of messages.
4.  **Dynamic Progress Tracking:** You must dynamically update the 'progress' object based on your analysis of the conversation's depth in each of the four core MBTI dimensions:
    * **Energy Source (Introversion vs. Extraversion):** How do they gain and lose energy?
    * **Information Processing (Sensing vs. Intuition):** Do they focus on concrete facts or abstract possibilities?
    * **Decision Making (Thinking vs. Feeling):** Do they prioritize logic or human values?
    * **Lifestyle & Organization (Judging vs. Perceiving):** Do they prefer structure or spontaneity?

**JSON Output Schema:**
Your entire response must conform to this schema.

-   **For an ongoing conversation:**
    {
      "ready_for_analysis": false,
      "one_liner": "<Your natural, engaging follow-up question or reflective comment.>",
      "progress": {
        "current_step": <integer 1-5>,
        "total_steps": 5,
        "step_description": "<A brief description of the current conversational focus, e.g., 'Exploring your decision-making style'>",
        "dimensions_explored": { "energy_source": <bool>, "information_processing": <bool>, "decision_making": <bool>, "lifestyle_preferences": <bool> }
      }
    }

-   **When providing the final analysis (set "ready_for_analysis" to true):**
    {
      "ready_for_analysis": true,
      "type": "<The inferred 4-letter MBTI type, e.g., 'INFJ'>",
      "confidence": <float between 0.6 and 0.95, representing your confidence>,
      "one_liner": "<A concise, one-sentence summary of this personality type.>",
      "reasoning": "<A brief paragraph explaining *why* you chose this type, referencing themes from the conversation. This is crucial.>",
      "strengths": ["<A key strength derived from the conversation>", "<Another key strength>", "<A third strength>"],
      "growth_tips": ["<A practical growth tip relevant to the user>", "<Another practical tip>", "<A third tip>"],
      "progress": { ...final progress state... }
    }

**Your Task Now:**
Analyze the provided message history.
- If the conversation is still developing, update the progress, ask a relevant and insightful follow-up question, and set "ready_for_analysis" to \`false\`.
- If the conversation has sufficient depth across all dimensions OR the user explicitly asks for their result with enough context, provide the complete, final analysis and set "ready_for_analysis" to \`true\`.`;


// --- 3. Refactored Core AI Logic ---

async function getAIResponseFromOpenAI(messages) {
  // NOTE: The user requested 'GPT-5'. As GPT-5 is not yet released, I am using 'gpt-4o',
  // OpenAI's most capable model currently available. You can update this model name
  // to 'gpt-5-...' or the official identifier upon its release.
  const model = 'gpt-4o';

  const requestBody = {
    model: model,
    messages: [
      { role: 'system', content: MBTI_SYSTEM_PROMPT },
      ...messages // The user's conversation history
    ],
    response_format: { type: "json_object" }, // Use OpenAI's JSON mode for reliable output
    temperature: 0.75, // Balance creativity and consistency
    max_tokens: 800,   // Allow sufficient space for a detailed final analysis
  };

  try {
    console.log(`🚀 Sending request to OpenAI with model: ${model}...`);
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: OPENAI_HEADERS,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('❌ OpenAI API Error:', response.status, errorBody);
      throw new Error(`OpenAI API request failed with status ${response.status}`);
    }

    const jsonResponse = await response.json();
    const aiContent = jsonResponse.choices[0].message.content;

    // The response content should already be a stringified JSON object due to "json_object" mode.
    // We return it directly to be saved and sent to the client.
    console.log('✅ Successfully received and parsed AI response.');
    return aiContent;

  } catch (error) {
    console.error('💥 An error occurred while communicating with OpenAI:', error);
    // Provide a graceful fallback error message in the required JSON format
    return JSON.stringify({
      ready_for_analysis: false,
      one_liner: "I'm sorry, I'm having a little trouble connecting right now. Could you please try asking that again in a moment?",
      progress: {
          current_step: 1, total_steps: 5, step_description: "System error",
          dimensions_explored: { energy_source: false, information_processing: false, decision_making: false, lifestyle_preferences: false }
      }
    });
  }
}

// --- 4. Main Netlify Handler Function (with Supabase integration) ---

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // Or your specific domain for production
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  
  // Ensure the API key is present before proceeding
  if (!process.env.OPENAI_API_KEY) {
      console.error('❌ CRITICAL: OPENAI_API_KEY is not set.');
      return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Server configuration error: API key missing.' })
      };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { messages } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid payload: messages array is required.' }) };
    }

    // Get the JSON response from the OpenAI model
    const aiResponseJsonString = await getAIResponseFromOpenAI(messages);

    let conversationIdForClient = Date.now(); // Fallback ID

    // Save the conversation to Supabase (if the client is available)
    if (supabase) {
      const fullConversation = [...messages, { role: 'assistant', content: aiResponseJsonString }];
      
      const { data, error } = await supabase
        .from('conversations')
        .insert({ conversation_history: fullConversation })
        .select('id')
        .single(); // Use .single() to get the object directly

      if (error) {
        console.error('❌ Supabase insert error:', error.message);
      } else if (data) {
        conversationIdForClient = data.id;
        console.log(`✅ Conversation saved to Supabase with ID: ${conversationIdForClient}`);
      }
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reply: aiResponseJsonString, // The frontend expects a stringified JSON
        conversation_id: conversationIdForClient
      })
    };

  } catch (error) {
    console.error('💥 Unhandled error in handler function:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'An unexpected error occurred.', message: error.message })
    };
  }
};