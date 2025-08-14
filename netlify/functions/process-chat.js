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
  'User-Agent': 'Mind-Mapper-AI/1.0'
};

// Preferred models in order of preference (all free) - updated based on testing
const PREFERRED_MODELS = [
    'meta-llama/llama-3.2-3b-instruct:free',  // Confirmed working
    'google/gemma-2-9b-it:free',
    'qwen/qwen-2.5-7b-instruct:free',
    'microsoft/phi-3-mini-128k-instruct:free'  // Moved to end since it failed
];

// Helper function to robustly handle API responses
async function getJsonResponse(response) {
    const responseText = await response.text();
    
    if (!response.ok) {
        console.error("API request failed. Status:", response.status);
        console.error("Response text:", responseText.substring(0, 500));
        throw new Error(`API request failed with status ${response.status}: ${response.statusText}`);
    }
    
    // Check if response looks like HTML (indicates wrong endpoint)
    if (responseText.trim().startsWith('<!DOCTYPE html')) {
        console.error("Received HTML instead of JSON - likely wrong endpoint or authentication issue");
        throw new Error("Received HTML instead of JSON from API - check authentication and endpoint");
    }
    
    try {
        return JSON.parse(responseText);
    } catch (e) {
        console.error("Failed to parse response as JSON. Raw text:", responseText);
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

    console.log('Processing chat request...');

    // 1. Create an embedding for semantic search
    let queryEmbedding = null;
    let similarConversations = null;
    
    try {
      console.log('Creating embedding...');
      const embeddingResponse = await fetch(`${OPENROUTER_API_BASE}/embeddings`, {
        method: 'POST',
        headers: OPENROUTER_HEADERS,
        body: JSON.stringify({
          model: 'sentence-transformers/all-minilm-l6-v2',
          input: latestMessage,
        }),
      });
      
      if (embeddingResponse.ok) {
        const embeddingJson = await getJsonResponse(embeddingResponse);
        queryEmbedding = embeddingJson.data[0].embedding;
        console.log('Embedding created successfully');

        // 2. Search Supabase for similar conversations
        try {
          const { data } = await supabase.rpc('match_conversations', {
            query_embedding: queryEmbedding,
            match_threshold: 0.7,
            match_count: 2,
          });
          similarConversations = data;
          console.log('Found', similarConversations?.length || 0, 'similar conversations');
        } catch (supabaseError) {
          console.log('Supabase search failed, continuing without context:', supabaseError.message);
        }
      } else {
        console.log('Embedding API failed, continuing without semantic search');
      }
    } catch (embeddingError) {
      console.log('Embedding step failed, continuing without semantic search:', embeddingError.message);
    }

    // 3. Construct enhanced prompt with context if available
    let systemPrompt = `You are Mind-Mapper AI, a helpful personality analyst assistant. You help users understand their personality types, analyze their behavior patterns, and provide insights for personal growth.`;
    
    if (similarConversations && similarConversations.length > 0) {
      systemPrompt += `\n\nFor context, here are some similar conversations you've had:\n${similarConversations.map(conv => `- ${JSON.stringify(conv.conversation_history)}`).join('\n')}`;
    }
    
    const finalMessages = [{ role: "system", content: systemPrompt }, ...messages];

    // 4. Get chat response using fallback model strategy
    console.log('Getting AI response...');
    const aiResponse = await tryModelsInOrder(finalMessages);
    console.log('AI response generated successfully');

    // 5. Save conversation to Supabase
    try {
      if (queryEmbedding) {
        const fullConversation = [...messages, { role: 'assistant', content: aiResponse }];
        const { data: newConversation, error: insertError } = await supabase
          .from('conversations')
          .insert({ 
            conversation_history: fullConversation, 
            embedding: queryEmbedding 
          })
          .select('id')
          .single();

        if (insertError) {
          console.error('Failed to save conversation:', insertError.message);
        } else {
          console.log('Conversation saved with ID:', newConversation.id);
        }
      }
    } catch (saveError) {
      console.log('Conversation saving failed, but continuing:', saveError.message);
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
        conversationId: null // Set to actual ID if saving succeeded
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