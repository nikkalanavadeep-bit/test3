const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables from backend/.env or root .env
const envPaths = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env')
];
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Supabase Client if credentials are provided
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;
const isPlaceholderKey = (key) => !key || key.includes('your-') || key.trim() === '';

if (supabaseUrl && supabaseKey && !isPlaceholderKey(supabaseUrl) && !isPlaceholderKey(supabaseKey)) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('⚡ Supabase Client initialized successfully.');
  } catch (err) {
    console.warn('⚠️ Supabase initialization warning:', err.message);
  }
}

// Enable CORS for frontend clients
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve frontend static files (allowing dotfiles so frontend can read its .env if requested)
const frontendDir = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir, { dotfiles: 'allow' }));
}

// Available Gemini Models
const AVAILABLE_MODELS = [
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    tag: 'Recommended',
    description: 'Fast, highly versatile model balanced for speed and quality.',
    contextWindow: '1M tokens'
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    tag: 'High Reasoning',
    description: 'Best for complex reasoning, in-depth code synthesis, and deep logic.',
    contextWindow: '2M tokens'
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    tag: 'Next-Gen Speed',
    description: 'Next-generation multimodal model with ultra-low latency.',
    contextWindow: '1M tokens'
  }
];

// Health & configuration check endpoint
app.get('/api/health', (req, res) => {
  const hasEnvKey = Boolean(process.env.GEMINI_API_KEY && !isPlaceholderKey(process.env.GEMINI_API_KEY));
  const hasSupabase = Boolean(supabase);

  res.json({
    status: 'ok',
    hasEnvKey,
    hasSupabase,
    defaultModel: process.env.DEFAULT_MODEL || 'gemini-1.5-flash',
    version: '1.1.0',
    timestamp: new Date().toISOString()
  });
});

// Public frontend configuration endpoint (safe public variables)
app.get('/api/config', (req, res) => {
  const publicSupabaseUrl = isPlaceholderKey(process.env.SUPABASE_URL) ? '' : process.env.SUPABASE_URL;
  const publicSupabaseAnonKey = isPlaceholderKey(process.env.SUPABASE_ANON_KEY) ? '' : process.env.SUPABASE_ANON_KEY;

  res.json({
    supabaseUrl: publicSupabaseUrl,
    supabaseAnonKey: publicSupabaseAnonKey,
    hasSupabase: Boolean(supabase),
    defaultModel: process.env.DEFAULT_MODEL || 'gemini-1.5-flash',
    backendUrl: `http://localhost:${PORT}`
  });
});

// Available models list
app.get('/api/models', (req, res) => {
  res.json({
    models: AVAILABLE_MODELS,
    defaultModel: process.env.DEFAULT_MODEL || 'gemini-1.5-flash'
  });
});

// ==============================================================================
// SUPABASE CHAT PERSISTENCE ENDPOINTS
// ==============================================================================

// GET all chats from Supabase
app.get('/api/chats', async (req, res) => {
  if (!supabase) {
    return res.json({ chats: [], storage: 'local', message: 'Supabase not configured' });
  }

  try {
    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    res.json({ chats: data || [], storage: 'supabase' });
  } catch (err) {
    console.error('Error fetching chats from Supabase:', err.message);
    res.status(500).json({ error: err.message, storage: 'error' });
  }
});

// POST / UPSERT a chat session in Supabase
app.post('/api/chats', async (req, res) => {
  if (!supabase) {
    return res.status(200).json({ status: 'skipped', message: 'Supabase not configured' });
  }

  const { id, title } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing chat id' });

  try {
    const { data, error } = await supabase
      .from('chats')
      .upsert({
        id,
        title: title || 'New Conversation',
        updated_at: new Date().toISOString()
      })
      .select();

    if (error) throw error;
    res.json({ status: 'ok', chat: data?.[0] });
  } catch (err) {
    console.error('Error upserting chat in Supabase:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE a chat session from Supabase
app.delete('/api/chats/:id', async (req, res) => {
  if (!supabase) {
    return res.json({ status: 'skipped' });
  }

  const { id } = req.params;
  try {
    const { error } = await supabase.from('chats').delete().eq('id', id);
    if (error) throw error;
    res.json({ status: 'ok', id });
  } catch (err) {
    console.error('Error deleting chat from Supabase:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET messages for a specific chat
app.get('/api/chats/:id/messages', async (req, res) => {
  if (!supabase) {
    return res.json({ messages: [] });
  }

  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ messages: data || [] });
  } catch (err) {
    console.error('Error fetching messages from Supabase:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Helper to save messages to Supabase safely in background
async function saveMessageToSupabase(chatId, role, content, title) {
  if (!supabase || !chatId || !content) return;

  try {
    // 1. Ensure chat exists
    await supabase.from('chats').upsert({
      id: chatId,
      title: title || content.substring(0, 36) + '...',
      updated_at: new Date().toISOString()
    });

    // 2. Insert message
    await supabase.from('messages').insert({
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      chat_id: chatId,
      role: (role === 'assistant' || role === 'model') ? 'model' : 'user',
      content: content,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    console.warn('Background Supabase save failed:', err.message);
  }
}

// ==============================================================================
// GEMINI CHAT COMPLETION & STREAMING ENDPOINT
// ==============================================================================

function resolveApiKey(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const key = authHeader.substring(7).trim();
    if (key && !isPlaceholderKey(key)) return key;
  }
  if (process.env.GEMINI_API_KEY && !isPlaceholderKey(process.env.GEMINI_API_KEY)) {
    return process.env.GEMINI_API_KEY.trim();
  }
  return null;
}

function formatGeminiHistory(history) {
  if (!Array.isArray(history)) return [];

  const formatted = [];
  for (const item of history) {
    if (!item || !item.content) continue;
    const role = (item.role === 'model' || item.role === 'assistant') ? 'model' : 'user';
    formatted.push({
      role,
      parts: [{ text: String(item.content) }]
    });
  }

  while (formatted.length > 0 && formatted[0].role !== 'user') {
    formatted.shift();
  }

  return formatted;
}

app.post('/api/chat', async (req, res) => {
  const {
    message,
    history = [],
    model = process.env.DEFAULT_MODEL || 'gemini-1.5-flash',
    systemInstruction,
    temperature = 0.7,
    stream = true,
    chatId = null,
    chatTitle = null
  } = req.body;

  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'Field "message" is required and cannot be empty.' });
  }

  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    return res.status(401).json({
      error: 'GEMINI_API_KEY is missing. Please add your API key in backend/.env or provide it in the frontend settings modal.',
      code: 'MISSING_API_KEY'
    });
  }

  // Save incoming user message to Supabase asynchronously
  if (chatId) {
    saveMessageToSupabase(chatId, 'user', message.trim(), chatTitle);
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelOptions = {
      model: model,
      generationConfig: {
        temperature: Number(temperature) || 0.7
      }
    };

    if (systemInstruction && systemInstruction.trim()) {
      modelOptions.systemInstruction = systemInstruction.trim();
    }

    const generativeModel = genAI.getGenerativeModel(modelOptions);
    const formattedHistory = formatGeminiHistory(history);

    const chatSession = generativeModel.startChat({
      history: formattedHistory
    });

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const resultStream = await chatSession.sendMessageStream(message.trim());
      let fullResponseText = '';

      for await (const chunk of resultStream.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          fullResponseText += chunkText;
          res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
        }
      }

      // Save complete model message to Supabase
      if (chatId && fullResponseText) {
        saveMessageToSupabase(chatId, 'model', fullResponseText, chatTitle);
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      const result = await chatSession.sendMessage(message.trim());
      const response = await result.response;
      const text = response.text();

      if (chatId && text) {
        saveMessageToSupabase(chatId, 'model', text, chatTitle);
      }

      return res.json({
        reply: text,
        model: model,
        finishReason: response.candidates?.[0]?.finishReason || 'STOP'
      });
    }
  } catch (error) {
    console.error('Error generating Gemini response:', error);
    const errorMessage = error?.message || 'An unexpected error occurred while communicating with Gemini.';

    if (!res.headersSent) {
      let statusCode = 500;
      let userFriendlyMessage = errorMessage;

      if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('API key not valid')) {
        statusCode = 401;
        userFriendlyMessage = 'Invalid Gemini API Key provided. Please verify your API key in backend/.env or the UI.';
      } else if (errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('Quota exceeded')) {
        statusCode = 429;
        userFriendlyMessage = 'Gemini API quota exceeded. Please wait a moment or check your Google AI Studio plan.';
      } else if (errorMessage.includes('models/')) {
        statusCode = 404;
        userFriendlyMessage = `The requested model "${model}" is unavailable or not supported for this API key.`;
      }

      return res.status(statusCode).json({
        error: userFriendlyMessage,
        details: errorMessage,
        code: error.status || 'GEMINI_ERROR'
      });
    } else {
      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

// Fallback route for SPA / root path
app.get('*', (req, res, next) => {
  const indexPath = path.join(frontendDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    next();
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🤖 Gemini Chatbot Backend Server Running!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`📁 Frontend: ${frontendDir}`);
  console.log(`🔑 Gemini Key: ${process.env.GEMINI_API_KEY && !isPlaceholderKey(process.env.GEMINI_API_KEY) ? 'Configured in .env' : 'NOT CONFIGURED in .env'}`);
  console.log(`⚡ Supabase: ${supabase ? 'Connected (' + supabaseUrl + ')' : 'Not configured (using local fallback)'}`);
  console.log(`===============================================`);
});
