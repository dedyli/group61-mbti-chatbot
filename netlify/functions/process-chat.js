// File Location: netlify/functions/process-chat.js

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client using environment variables
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Define constants for the OpenRouter API
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS = {
  'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://group61project.netlify.app/', // Make sure this is your correct Netlify URL
  'X-Title': 'Mind-Mapper AI',
};

// Helper function to robustly handle API responses
async function getJsonResponse(response) {
    const responseText = await response.text(); // Read the body as text ONCE
    if (!response.ok) {
        // If the response is not OK, log the raw text and throw an error
        console.error("API request failed. Raw text from API:", responseText);
        throw new Error(`API request failed with status ${response.status}`);
    }
    try {
        return JSON.parse(responseText); // Try to parse the text as JSON
    } catch (e) {
        console.error("Failed to parse response as JSON. Raw text from API:", responseText);
        throw new Error("Invalid JSON response from API.");
    }
}


export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { messages } = JSON.parse(event.body);
    const latestMessage = messages[messages.length - 1].content;

    // 1. Create an embedding
    const embeddingResponse = await fetch(`${OPENROUTER_API_BASE}/embeddings`, {
      method: 'POST',
      headers: OPENROUTER_HEADERS,
      body: JSON.stringify({
        model: 'sentence-transformers/all-minilm-l6-v2',
        input: latestMessage,
      }),
    });
    const embeddingJson = await getJsonResponse(embeddingResponse);
    const queryEmbedding = embeddingJson.data[0].embedding;


    // 2. Search Supabase
    const { data: similarConversations } = await supabase.rpc('match_conversations', {
      query_embedding: queryEmbedding,
      match_threshold: 0.7,
      match_count: 2,
    });

    // 3. Construct prompt
    const systemPrompt = `You are Mind-Mapper AI...`; // (Content is the same)
    const finalMessages = [{ role: "system", content: systemPrompt }, ...messages];

    // 4. Get chat response
    const chatResponse = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: OPENROUTER_HEADERS,
        body: JSON.stringify({
            model: 'deepseek/deepseek-r1-distill-llama-70b:free',
            messages: finalMessages,
        })
    });
    const chatJson = await getJsonResponse(chatResponse);
    const aiResponse = chatJson.choices[0].message.content;

    // 5. Save to Supabase
    const fullConversation = [...messages, { role: 'assistant', content: aiResponse }];
    const { data: newConversation, error: insertError } = await supabase
      .from('conversations')
      .insert({ conversation_history: fullConversation, embedding: queryEmbedding })
      .select('id')
      .single();

    if (insertError) throw insertError;

    // 6. Return success response
    return {
      statusCode: 200,
      body: JSON.stringify({ response: aiResponse, conversationId: newConversation.id }),
    };

  } catch (error) {
    console.error('Error in process-chat function:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'An internal server error occurred.' })
    };
  }
};