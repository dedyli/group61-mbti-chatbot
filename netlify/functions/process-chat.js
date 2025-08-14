// File Location: netlify/functions/process-chat.js

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client using environment variables
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Define constants for the OpenRouter API
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS = {
  'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
  'Content-Type': 'application/json',
  // Recommended by OpenRouter: identify your app with a URL and title
  'HTTP-Referer': 'https://group61project.netlify.app/', // Make sure this is your correct Netlify URL
  'X-Title': 'Mind-Mapper AI',
};

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { messages } = JSON.parse(event.body);
    const latestMessage = messages[messages.length - 1].content;

    // 1. Create an embedding for the latest message
    const embeddingResponse = await fetch(`${OPENROUTER_API_BASE}/embeddings`, {
      method: 'POST',
      headers: OPENROUTER_HEADERS,
      body: JSON.stringify({
        model: 'sentence-transformers/all-minilm-l6-v2', // Model produces vector of size 384
        input: latestMessage,
      }),
    });

    // --- Diagnostic block for embedding response ---
    let embeddingJson;
    try {
      embeddingJson = await embeddingResponse.json();
    } catch (e) {
      const errorText = await embeddingResponse.text();
      console.error("Failed to parse embedding response. Raw text from API:", errorText);
      throw new Error(`Invalid JSON response from embedding API. Status: ${embeddingResponse.status}`);
    }
    // --- End diagnostic block ---

    if (!embeddingResponse.ok) {
        throw new Error(`Embedding API failed with status ${embeddingResponse.status}: ${JSON.stringify(embeddingJson)}`);
    }
    const queryEmbedding = embeddingJson.data[0].embedding;


    // 2. Search for similar past conversations in Supabase
    const { data: similarConversations } = await supabase.rpc('match_conversations', {
      query_embedding: queryEmbedding,
      match_threshold: 0.7, // Similarity threshold (adjust as needed)
      match_count: 2,       // Number of similar conversations to retrieve
    });

    // 3. Construct the augmented system prompt for the main chat model
    const systemPrompt = `You are Mind-Mapper AI, a warm, insightful personality analyst for students.
      Here are some examples of similar past conversations to learn from:
      ${JSON.stringify(similarConversations)}
      ---
      Now, continue the current conversation insightfully.`;

    const finalMessages = [{ role: "system", content: systemPrompt }, ...messages];

    // 4. Get the final chat response from DeepSeek via OpenRouter
    const chatResponse = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: OPENROUTER_HEADERS,
        body: JSON.stringify({
            model: 'deepseek/deepseek-r1-distill-llama-70b:free', // Your chosen DeepSeek model
            messages: finalMessages,
        })
    });

    // --- Diagnostic block for chat response ---
    let chatJson;
    try {
      chatJson = await chatResponse.json();
    } catch (e) {
      const errorText = await chatResponse.text();
      console.error("Failed to parse chat response. Raw text from API:", errorText);
      throw new Error(`Invalid JSON response from chat API. Status: ${chatResponse.status}`);
    }
    // --- End diagnostic block ---

    if (!chatResponse.ok) {
        throw new Error(`Chat API failed with status ${chatResponse.status}: ${JSON.stringify(chatJson)}`);
    }
    const aiResponse = chatJson.choices[0].message.content;

    // 5. Save the new conversation and get its ID
    const fullConversation = [...messages, { role: 'assistant', content: aiResponse }];
    const { data: newConversation, error: insertError } = await supabase
      .from('conversations')
      .insert({
        conversation_history: fullConversation,
        embedding: queryEmbedding,
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    // 6. Return the AI's response AND the new conversation's ID to the frontend
    return {
      statusCode: 200,
      body: JSON.stringify({
        response: aiResponse,
        conversationId: newConversation.id,
      }),
    };

  } catch (error) {
    console.error('Error in process-chat function:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'An internal server error occurred.' })
    };
  }
};