// Function to validate AI response quality
function isValidResponse(response) {
    if (!response || response.length < 10) return false;
    
    // Check for garbled text patterns
    const garbledPatterns = [
        /[^\x20-\x7E\u00A0-\u024F\u1E00-\u1EFF]/g, // Non-printable characters
        /(.)\1{10,}/g, // Repeated characters
        /[A-Za-z]{50,}/g, // Extremely long words
    ];
    
    for (const pattern of garbledPatterns) {
        if (pattern.test(response)) {
            console.log('Detected garbled response pattern');
            return false;
        }
    }
    
    return true;
}// File Location: netlify/functions/process-chat.js

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

// Using only DeepSeek Chat for ultra-low cost MBTI analysis
const PREFERRED_MODELS = [
    'deepseek/deepseek-chat'  // Single model: Ultra cheap, good MBTI analysis
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

// Function to use DeepSeek Chat only
async function tryModelsInOrder(messages) {
    const model = 'deepseek/deepseek-chat';
    
    try {
        console.log(`Using DeepSeek Chat...`);
        const chatResponse = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
            method: 'POST',
            headers: OPENROUTER_HEADERS,
            body: JSON.stringify({
                model: model,
                messages: messages,
                max_tokens: 200, // Shorter limit for concise responses
                temperature: 0.7,
            })
        });
        
        if (chatResponse.ok) {
            const chatJson = await getJsonResponse(chatResponse);
            const aiResponse = chatJson.choices[0].message.content;
            
            // Validate the response quality
            if (isValidResponse(aiResponse)) {
                console.log(`Success with DeepSeek Chat`);
                return aiResponse;
            } else {
                console.log(`DeepSeek Chat returned garbled response`);
                return "I apologize, but I'm having difficulty processing your request right now. Please try rephrasing your question.";
            }
        } else {
            console.log(`DeepSeek Chat failed with status: ${chatResponse.status}`);
            return "I'm experiencing technical difficulties. Please try again in a moment.";
        }
    } catch (error) {
        console.log(`DeepSeek Chat error:`, error.message);
        return "I apologize, but I'm having trouble connecting right now. Please try again shortly.";
    }
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
          model: 'text-embedding-3-small', // Use a more reliable embedding model
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
    let systemPrompt = `You are Mind-Mapper AI. Help users understand their personality. Keep responses short, clear, and helpful. Aim for 2-3 sentences maximum.`;
    
    if (similarConversations && similarConversations.length > 0) {
      systemPrompt += `\n\nContext: You've had similar conversations before.`;
    }
    
    const finalMessages = [{ role: "system", content: systemPrompt }, ...messages];

    // 4. Get chat response using fallback model strategy
    console.log('Getting AI response...');
    const aiResponse = await tryModelsInOrder(finalMessages);
    console.log('AI response generated successfully');

    // 5. Save conversation to Supabase (regardless of embedding success)
    try {
      const fullConversation = [...messages, { role: 'assistant', content: aiResponse }];
      const { data: newConversation, error: insertError } = await supabase
        .from('conversations')
        .insert({ 
          conversation_history: fullConversation, 
          embedding: queryEmbedding // This can be null if embeddings failed
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('Failed to save conversation:', insertError.message);
      } else {
        console.log('Conversation saved with ID:', newConversation.id);
      }
    } catch (saveError) {
      console.error('Conversation saving failed:', saveError.message);
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