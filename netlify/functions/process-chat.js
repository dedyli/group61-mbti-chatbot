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

// Preferred models in order of preference (all free)
const PREFERRED_MODELS = [
    'microsoft/phi-3-mini-128k-instruct:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'google/gemma-2-9b-it:free',
    'qwen/qwen-2.5-7b-instruct:free'
];

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

// Function to try models in order until one works
async function tryModelsInOrder(messages) {
    for (const model of PREFERRED_MODELS) {
        try {
            console.log(`Trying model: ${model}`);
            const chatResponse = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
                method: 'POST',
                headers: OPENROUTER_HEADERS,
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                })
            });
            
            if (chatResponse.ok) {
                const chatJson = await getJsonResponse(chatResponse);
                console.log(`Success with model: ${model}`);
                return chatJson.choices[0].message.content;
            } else {
                console.log(`Model ${model} failed with status: ${chatResponse.status}`);
                continue;
            }
        } catch (error) {
            console.log(`Model ${model} error:`, error.message);
            continue;
        }
    }
    throw new Error('All models failed to respond');
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
    const systemPrompt = `You are Mind-Mapper AI, a helpful personality analyst assistant.`; 
    const finalMessages = [{ role: "system", content: systemPrompt }, ...messages];

    // 4. Get chat response using fallback model strategy
    const aiResponse = await tryModelsInOrder(finalMessages);

    // 5. Save to Supabase
    const fullConversation = [...messages, { role: 'assistant', content: aiResponse }];
    const { data: newConversation, error: insertError } = await supabase
      .from('conversations')
      .insert({ conversation_history: fullConversation, embedding: queryEmbedding })
      .select('id')
      .single();

    if (insertError) {
        console.error('Supabase insert error:', insertError);
        // Don't throw here - still return the AI response even if saving fails
    }

    // 6. Return success response
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        response: aiResponse, 
        conversationId: newConversation?.id || null 
      }),
    };

  } catch (error) {
    console.error('Error in process-chat function:', error.message);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        error: error.message || 'An internal server error occurred.' 
      })
    };
  }
};