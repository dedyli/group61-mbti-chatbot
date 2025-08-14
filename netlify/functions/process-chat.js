// File Location: netlify/functions/process-chat.js

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client using environment variables
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Define constants for the OpenRouter API
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS = {
  'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://group61project.netlify.app/',
  'X-Title': 'Mind-Mapper AI'
};

// Models ordered by reliability and quality for MBTI analysis
const PREFERRED_MODELS = [
    'anthropic/claude-3-haiku',           // Best quality, very fast, low cost
    'google/gemini-flash-1.5',            // Free tier, good quality
    'meta-llama/llama-3.1-8b-instruct',  // Ultra cheap fallback
    'deepseek/deepseek-chat'              // Last resort fallback
];

// MBTI-optimized system prompt
const MBTI_SYSTEM_PROMPT = `You are Mind-Mapper AI, an expert in MBTI personality analysis.

INSTRUCTIONS:
1. Provide clear, concise responses (2-3 sentences maximum)
2. Focus on actionable insights about personality traits
3. Use specific MBTI terminology when relevant (e.g., cognitive functions: Ti, Fe, Ni, Se)
4. Be encouraging and constructive
5. If asked about MBTI type, explain briefly WHY you see those traits

RESPONSE FORMAT:
- Direct and practical
- No fluff or unnecessary elaboration
- Specific examples when helpful
- Always under 50 words unless explicitly asked for more detail`;

// Function to validate AI response quality
function isValidResponse(response) {
    if (!response || response.length < 10) return false;
    
    // Check for garbled text patterns
    const garbledPatterns = [
        /[^\x20-\x7E\u00A0-\u024F\u1E00-\u1EFF\u4E00-\u9FFF]/g, // Allow common unicode
        /(.)\1{10,}/g, // Repeated characters
        /[A-Za-z]{50,}/g, // Extremely long words
    ];
    
    for (const pattern of garbledPatterns) {
        if (pattern.test(response)) {
            console.log('Detected garbled response pattern');
            return false;
        }
    }
    
    // Check if response seems MBTI-relevant
    const mbtiKeywords = ['personality', 'type', 'trait', 'prefer', 'tend', 'cognitive', 'function'];
    const hasRelevance = mbtiKeywords.some(keyword => 
        response.toLowerCase().includes(keyword)
    );
    
    return true; // Accept even without keywords for general questions
}

// Helper function to robustly handle API responses
async function getJsonResponse(response) {
    const responseText = await response.text();
    
    if (!response.ok) {
        console.error("API request failed. Status:", response.status);
        console.error("Response preview:", responseText.substring(0, 200));
        
        // Check for specific error patterns
        if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
            throw new Error("Authentication failed - check API key");
        }
        if (response.status === 401) {
            throw new Error("Invalid API key");
        }
        if (response.status === 429) {
            throw new Error("Rate limit exceeded");
        }
        
        throw new Error(`API error ${response.status}`);
    }
    
    try {
        return JSON.parse(responseText);
    } catch (e) {
        console.error("Failed to parse JSON:", responseText.substring(0, 200));
        throw new Error("Invalid JSON response from API");
    }
}

// Enhanced model fallback with specific parameters for each
async function tryModelsInOrder(messages) {
    for (const model of PREFERRED_MODELS) {
        try {
            console.log(`Trying model: ${model}`);
            
            // Model-specific parameters
            const modelParams = {
                'anthropic/claude-3-haiku': {
                    max_tokens: 150,
                    temperature: 0.7,
                    top_p: 0.9
                },
                'google/gemini-flash-1.5': {
                    max_tokens: 150,
                    temperature: 0.7,
                    top_p: 0.95
                },
                'meta-llama/llama-3.1-8b-instruct': {
                    max_tokens: 100,
                    temperature: 0.6,
                    top_p: 0.9,
                    repetition_penalty: 1.1
                },
                'deepseek/deepseek-chat': {
                    max_tokens: 100,
                    temperature: 0.6
                }
            };
            
            const params = modelParams[model] || { max_tokens: 150, temperature: 0.7 };
            
            const chatResponse = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
                method: 'POST',
                headers: OPENROUTER_HEADERS,
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    ...params
                })
            });
            
            if (chatResponse.ok) {
                const chatJson = await getJsonResponse(chatResponse);
                
                if (!chatJson.choices || !chatJson.choices[0]) {
                    console.log(`${model}: Invalid response structure`);
                    continue;
                }
                
                const aiResponse = chatJson.choices[0].message.content;
                
                if (isValidResponse(aiResponse)) {
                    console.log(`Success with ${model}`);
                    return aiResponse;
                } else {
                    console.log(`${model}: Response validation failed`);
                    continue;
                }
            } else {
                const errorText = await chatResponse.text();
                console.log(`${model} failed (${chatResponse.status}):`, errorText.substring(0, 100));
                continue;
            }
        } catch (error) {
            console.log(`${model} error:`, error.message);
            continue;
        }
    }
    
    // All models failed
    return "I'm having difficulty analyzing your personality query right now. Please try rephrasing your question, or ask me about specific MBTI traits like introversion/extraversion.";
}

// Embedding function with better error handling
async function createEmbedding(text) {
    try {
        const embeddingResponse = await fetch(`${OPENROUTER_API_BASE}/embeddings`, {
            method: 'POST',
            headers: OPENROUTER_HEADERS,
            body: JSON.stringify({
                model: 'openai/text-embedding-3-small', // More reliable model name
                input: text,
            }),
        });
        
        if (embeddingResponse.ok) {
            const embeddingJson = await getJsonResponse(embeddingResponse);
            return embeddingJson.data[0].embedding;
        }
    } catch (error) {
        console.log('Embedding creation failed:', error.message);
    }
    return null;
}

export const handler = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: ''
        };
    }
    
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { messages } = JSON.parse(event.body);
        const latestMessage = messages[messages.length - 1].content;

        console.log('Processing MBTI analysis request...');

        // 1. Try to create embedding for semantic search (optional enhancement)
        const queryEmbedding = await createEmbedding(latestMessage);
        
        let similarConversations = null;
        if (queryEmbedding) {
            try {
                const { data } = await supabase.rpc('match_conversations', {
                    query_embedding: queryEmbedding,
                    match_threshold: 0.7,
                    match_count: 2,
                });
                similarConversations = data;
                console.log('Found', similarConversations?.length || 0, 'similar conversations');
            } catch (error) {
                console.log('Supabase search skipped:', error.message);
            }
        }

        // 2. Construct messages with MBTI-focused system prompt
        let systemContent = MBTI_SYSTEM_PROMPT;
        
        if (similarConversations && similarConversations.length > 0) {
            systemContent += "\n\nNote: You've discussed similar personality topics before. Build on previous insights if relevant.";
        }
        
        const finalMessages = [
            { role: "system", content: systemContent },
            ...messages
        ];

        // 3. Get AI response with fallback chain
        const aiResponse = await tryModelsInOrder(finalMessages);
        console.log('MBTI analysis generated successfully');

        // 4. Save conversation to Supabase
        try {
            const fullConversation = [...messages, { role: 'assistant', content: aiResponse }];
            const { data: newConversation } = await supabase
                .from('conversations')
                .insert({ 
                    conversation_history: fullConversation, 
                    embedding: queryEmbedding,
                    model_used: 'multi-model-fallback',
                    timestamp: new Date().toISOString()
                })
                .select('id')
                .single();

            if (newConversation) {
                console.log('Conversation saved with ID:', newConversation.id);
            }
        } catch (saveError) {
            console.error('Failed to save conversation:', saveError.message);
        }

        // 5. Return success response
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                response: aiResponse,
                model: 'optimized-mbti-analyzer'
            }),
        };

    } catch (error) {
        console.error('Critical error in process-chat:', error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                error: 'Service temporarily unavailable. Please try again.',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        };
    }
};