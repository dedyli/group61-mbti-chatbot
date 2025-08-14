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
    
    // Log response details for debugging
    console.log(`Response status: ${response.status}`);
    console.log(`Response headers:`, Object.fromEntries(response.headers.entries()));
    console.log(`Response URL: ${response.url}`);
    console.log(`Response text preview: ${responseText.substring(0, 200)}...`);
    
    if (!response.ok) {
        console.error("API request failed. Status:", response.status);
        console.error("Full response text:", responseText);
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

    console.log('Processing chat request with message:', latestMessage);
    console.log('Using API key:', process.env.OPENROUTER_API_KEY ? 'API key found' : 'API key missing');

    // Skip embeddings for now to test chat functionality
    console.log('Skipping embeddings step for debugging...');

    // 3. Construct prompt
    const systemPrompt = `You are Mind-Mapper AI, a helpful personality analyst assistant.`; 
    const finalMessages = [{ role: "system", content: systemPrompt }, ...messages];

    // 4. Get chat response using fallback model strategy
    console.log('Attempting to get chat response...');
    const aiResponse = await tryModelsInOrder(finalMessages);

    console.log('Successfully got AI response:', aiResponse.substring(0, 100) + '...');

    // 6. Return success response (skip Supabase for now)
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        response: aiResponse, 
        conversationId: null // Skip for debugging
      }),
    };

  } catch (error) {
    console.error('Error in process-chat function:', error.message);
    console.error('Full error:', error);
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