/**
 * Gemini AI Chatbot - Full-Featured Client Application with Supabase Integration
 * Handles SSE streaming, history persistence in Supabase & LocalStorage, model switching, personas, and markdown formatting.
 */

(function () {
  'use strict';

  // --- Persona System Instructions ---
  const PERSONAS = {
    assistant: {
      name: 'Helpful Assistant',
      systemPrompt: 'You are Gemini, a helpful, intelligent, empathetic, and highly knowledgeable AI assistant. Provide clear, well-structured, insightful responses.'
    },
    coder: {
      name: 'Code Architect',
      systemPrompt: 'You are an elite Principal Software Engineer and System Architect. Provide clean, secure, idiomatic, and robust code snippets with clear explanations of design decisions and edge cases.'
    },
    creative: {
      name: 'Creative Brain',
      systemPrompt: 'You are an award-winning creative strategist and storyteller. Respond with vivid imagery, original metaphors, imaginative hooks, and dynamic perspectives.'
    },
    concise: {
      name: 'Concise Exec',
      systemPrompt: 'You are a high-level executive advisor. Keep all responses exceptionally concise, bullet-pointed, zero-fluff, and directly actionable.'
    }
  };

  // --- Application State ---
  const state = {
    backendUrl: localStorage.getItem('gemini_backend_url') || 'http://localhost:5000',
    apiKeyOverride: localStorage.getItem('gemini_api_key_override') || '',
    supabaseUrl: localStorage.getItem('gemini_supabase_url') || '',
    supabaseAnonKey: localStorage.getItem('gemini_supabase_anon_key') || '',
    supabaseClient: null,
    hasSupabase: false,
    model: localStorage.getItem('gemini_selected_model') || 'gemini-1.5-flash',
    activePersona: localStorage.getItem('gemini_persona') || 'assistant',
    customSystemPrompt: localStorage.getItem('gemini_custom_system_prompt') || '',
    temperature: parseFloat(localStorage.getItem('gemini_temperature') || '0.7'),
    stream: localStorage.getItem('gemini_stream') !== 'false',
    currentChatId: null,
    chats: [],
    messages: [],
    isStreaming: false,
    activeAbortController: null,
    hasBackendKey: false
  };

  // --- DOM Elements ---
  const elements = {
    sidebar: document.getElementById('sidebar'),
    sidebarToggleBtn: document.getElementById('sidebar-toggle-btn'),
    newChatBtn: document.getElementById('new-chat-btn'),
    clearAllHistoryBtn: document.getElementById('clear-all-history-btn'),
    historyList: document.getElementById('history-list'),
    statusDot: document.getElementById('status-dot'),
    statusLabel: document.getElementById('status-label'),
    supabaseDot: document.getElementById('supabase-dot'),
    supabaseLabel: document.getElementById('supabase-label'),
    openSettingsFromFooter: document.getElementById('open-settings-from-footer'),
    modelSelect: document.getElementById('model-select'),
    exportChatBtn: document.getElementById('export-chat-btn'),
    clearChatBtn: document.getElementById('clear-chat-btn'),
    settingsBtn: document.getElementById('settings-btn'),
    apiKeyBanner: document.getElementById('api-key-banner'),
    bannerConfigureBtn: document.getElementById('banner-configure-btn'),
    messagesContainer: document.getElementById('messages-container'),
    welcomeScreen: document.getElementById('welcome-screen'),
    chatFeed: document.getElementById('chat-feed'),
    typingIndicator: document.getElementById('typing-indicator'),
    chatForm: document.getElementById('chat-form'),
    userInput: document.getElementById('user-input'),
    sendBtn: document.getElementById('send-btn'),
    stopBtn: document.getElementById('stop-btn'),
    // Settings Modal
    settingsModal: document.getElementById('settings-modal'),
    closeModalBtn: document.getElementById('close-modal-btn'),
    backendUrlInput: document.getElementById('backend-url-input'),
    testConnectionBtn: document.getElementById('test-connection-btn'),
    apiKeyInput: document.getElementById('api-key-input'),
    toggleKeyVisibility: document.getElementById('toggle-key-visibility'),
    supabaseUrlInput: document.getElementById('supabase-url-input'),
    supabaseKeyInput: document.getElementById('supabase-key-input'),
    toggleSupabaseKeyVisibility: document.getElementById('toggle-supabase-key-visibility'),
    testSupabaseBtn: document.getElementById('test-supabase-btn'),
    customSystemPrompt: document.getElementById('custom-system-prompt'),
    temperatureSlider: document.getElementById('temperature-slider'),
    tempVal: document.getElementById('temp-val'),
    tempBadge: document.getElementById('temp-badge'),
    streamToggle: document.getElementById('stream-toggle'),
    saveSettingsBtn: document.getElementById('save-settings-btn'),
    toastContainer: document.getElementById('toast-container')
  };

  // Configure marked.js for syntax highlighting and safe links
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,
      gfm: true,
      highlight: function (code, lang) {
        if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang }).value;
          } catch (e) {
            console.error('Highlight error', e);
          }
        }
        if (typeof hljs !== 'undefined') {
          return hljs.highlightAuto(code).value;
        }
        return code;
      }
    });
  }

  // --- Environment & Config Loader ---
  async function loadEnvironmentConfigs() {
    // 1. Try to read frontend/.env if available
    try {
      const envRes = await fetch('./.env');
      if (envRes.ok) {
        const envText = await envRes.text();
        const lines = envText.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const [key, ...rest] = trimmed.split('=');
          const val = rest.join('=').trim();
          if (!key || !val || val.includes('your-')) continue;

          if ((key === 'SUPABASE_URL' || key === 'VITE_SUPABASE_URL') && !state.supabaseUrl) {
            state.supabaseUrl = val;
          }
          if ((key === 'SUPABASE_ANON_KEY' || key === 'VITE_SUPABASE_ANON_KEY') && !state.supabaseAnonKey) {
            state.supabaseAnonKey = val;
          }
          if (key === 'BACKEND_URL' && !localStorage.getItem('gemini_backend_url')) {
            state.backendUrl = val;
          }
        }
      }
    } catch (_) {
      // Local file access fallback
    }

    // 2. Try to fetch /api/config from backend
    try {
      const configRes = await fetch(`${state.backendUrl}/api/config`);
      if (configRes.ok) {
        const configData = await configRes.json();
        if (configData.supabaseUrl && !state.supabaseUrl) {
          state.supabaseUrl = configData.supabaseUrl;
        }
        if (configData.supabaseAnonKey && !state.supabaseAnonKey) {
          state.supabaseAnonKey = configData.supabaseAnonKey;
        }
      }
    } catch (_) {
      // Backend may be offline initially
    }

    // Initialize Supabase Client
    initSupabaseClient();
  }

  function isPlaceholder(val) {
    return !val || val.includes('your-') || val.trim() === '';
  }

  function initSupabaseClient() {
    if (window.supabase && state.supabaseUrl && state.supabaseAnonKey && !isPlaceholder(state.supabaseUrl) && !isPlaceholder(state.supabaseAnonKey)) {
      try {
        state.supabaseClient = window.supabase.createClient(state.supabaseUrl, state.supabaseAnonKey);
        state.hasSupabase = true;
        if (elements.supabaseDot) elements.supabaseDot.className = 'status-dot connected';
        if (elements.supabaseLabel) elements.supabaseLabel.textContent = 'Database: Supabase 🟢';
        return true;
      } catch (err) {
        console.warn('Failed to initialize Supabase client:', err);
      }
    }

    state.supabaseClient = null;
    state.hasSupabase = false;
    if (elements.supabaseDot) elements.supabaseDot.className = 'status-dot';
    if (elements.supabaseLabel) elements.supabaseLabel.textContent = 'Database: Local Storage 📁';
    return false;
  }

  // --- Initialization ---
  async function init() {
    await loadEnvironmentConfigs();
    loadSettingsIntoUI();
    attachEventListeners();
    await checkBackendHealth();
    await loadStoredChats();
    startNewChat(false);
  }

  // --- Load UI State ---
  function loadSettingsIntoUI() {
    elements.backendUrlInput.value = state.backendUrl;
    elements.apiKeyInput.value = state.apiKeyOverride;
    elements.supabaseUrlInput.value = state.supabaseUrl;
    elements.supabaseKeyInput.value = state.supabaseAnonKey;
    elements.modelSelect.value = state.model;
    elements.temperatureSlider.value = state.temperature;
    elements.tempVal.textContent = state.temperature.toFixed(2);
    elements.streamToggle.checked = state.stream;
    elements.customSystemPrompt.value = state.customSystemPrompt;
    updateTempBadge(state.temperature);

    document.querySelectorAll('.persona-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.persona === state.activePersona);
    });
  }

  function updateTempBadge(temp) {
    if (temp < 0.3) {
      elements.tempBadge.textContent = 'Precise & Factual';
    } else if (temp > 0.8) {
      elements.tempBadge.textContent = 'Highly Creative';
    } else {
      elements.tempBadge.textContent = 'Balanced';
    }
  }

  // --- Backend Health & API Key Status ---
  async function checkBackendHealth() {
    elements.statusDot.className = 'status-dot checking';
    elements.statusLabel.textContent = 'Checking server...';

    try {
      const res = await fetch(`${state.backendUrl}/api/health`, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();

      state.hasBackendKey = Boolean(data.hasEnvKey);
      const isConfigured = state.hasBackendKey || Boolean(state.apiKeyOverride);

      if (isConfigured) {
        elements.statusDot.className = 'status-dot connected';
        elements.statusLabel.textContent = state.hasBackendKey ? 'Connected (.env Key)' : 'Connected (Custom Key)';
        elements.apiKeyBanner.style.display = 'none';
      } else {
        elements.statusDot.className = 'status-dot warning';
        elements.statusLabel.textContent = 'Connected (Key Needed)';
        elements.apiKeyBanner.style.display = 'flex';
      }

      // If backend has Supabase, reflect it if client doesn't already have it
      if (data.hasSupabase && !state.hasSupabase) {
        if (elements.supabaseDot) elements.supabaseDot.className = 'status-dot connected';
        if (elements.supabaseLabel) elements.supabaseLabel.textContent = 'Database: Supabase (via Server) 🟢';
      }
    } catch (err) {
      console.warn('Backend connection failed:', err);
      elements.statusDot.className = 'status-dot warning';
      elements.statusLabel.textContent = 'Backend Offline';
      elements.apiKeyBanner.style.display = 'flex';
    }
  }

  // --- Event Listeners ---
  function attachEventListeners() {
    // Sidebar toggle (for smaller screens)
    elements.sidebarToggleBtn.addEventListener('click', () => {
      elements.sidebar.classList.toggle('collapsed');
    });

    // New Chat Button
    elements.newChatBtn.addEventListener('click', () => {
      startNewChat(true);
    });

    // Clear All History Button
    elements.clearAllHistoryBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to delete all saved conversations?')) {
        state.chats = [];
        saveChatsToStorage();

        // If Supabase is available, clear user's chats
        if (state.supabaseClient) {
          try {
            await state.supabaseClient.from('chats').delete().neq('id', '');
          } catch (e) {
            console.warn('Supabase bulk delete failed:', e);
          }
        }

        renderHistoryList();
        startNewChat(false);
        showToast('All chat history cleared', 'success');
      }
    });

    // Clear Current Chat
    elements.clearChatBtn.addEventListener('click', () => {
      if (state.messages.length === 0) return;
      if (confirm('Clear messages in this conversation?')) {
        state.messages = [];
        elements.chatFeed.innerHTML = '';
        elements.welcomeScreen.style.display = 'flex';
        updateCurrentChatInStorage();
        showToast('Conversation cleared', 'success');
      }
    });

    // Export Chat to Markdown
    elements.exportChatBtn.addEventListener('click', exportConversation);

    // Persona Selection Chips
    document.querySelectorAll('.persona-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.persona-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.activePersona = chip.dataset.persona;
        localStorage.setItem('gemini_persona', state.activePersona);
        showToast(`Persona switched to: ${PERSONAS[state.activePersona].name}`, 'success');
      });
    });

    // Model Dropdown Change
    elements.modelSelect.addEventListener('change', (e) => {
      state.model = e.target.value;
      localStorage.setItem('gemini_selected_model', state.model);
      showToast(`Model set to: ${state.model}`, 'success');
    });

    // Starter Prompt Cards
    document.querySelectorAll('.starter-card').forEach(card => {
      card.addEventListener('click', () => {
        const prompt = card.dataset.prompt;
        if (prompt) {
          elements.userInput.value = prompt;
          autoResizeTextarea();
          elements.userInput.focus();
          elements.sendBtn.disabled = false;
        }
      });
    });

    // Textarea input auto-grow & enter key submit
    elements.userInput.addEventListener('input', () => {
      autoResizeTextarea();
      elements.sendBtn.disabled = elements.userInput.value.trim() === '' || state.isStreaming;
    });

    elements.userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!elements.sendBtn.disabled) {
          handleChatSubmit();
        }
      }
    });

    // Form submit
    elements.chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleChatSubmit();
    });

    // Stop Streaming Button
    elements.stopBtn.addEventListener('click', () => {
      if (state.activeAbortController) {
        state.activeAbortController.abort();
        state.activeAbortController = null;
        showToast('Generation stopped', 'warning');
      }
    });

    // Settings Modal
    elements.settingsBtn.addEventListener('click', openSettingsModal);
    elements.bannerConfigureBtn.addEventListener('click', openSettingsModal);
    elements.openSettingsFromFooter.addEventListener('click', openSettingsModal);
    elements.closeModalBtn.addEventListener('click', closeSettingsModal);

    elements.settingsModal.addEventListener('click', (e) => {
      if (e.target === elements.settingsModal) closeSettingsModal();
    });

    // Password visibility toggles
    elements.toggleKeyVisibility.addEventListener('click', () => {
      const type = elements.apiKeyInput.type === 'password' ? 'text' : 'password';
      elements.apiKeyInput.type = type;
      elements.toggleKeyVisibility.textContent = type === 'password' ? '👁️' : '🙈';
    });

    if (elements.toggleSupabaseKeyVisibility) {
      elements.toggleSupabaseKeyVisibility.addEventListener('click', () => {
        const type = elements.supabaseKeyInput.type === 'password' ? 'text' : 'password';
        elements.supabaseKeyInput.type = type;
        elements.toggleSupabaseKeyVisibility.textContent = type === 'password' ? '👁️' : '🙈';
      });
    }

    // Temperature slider live label
    elements.temperatureSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      elements.tempVal.textContent = val.toFixed(2);
      updateTempBadge(val);
    });

    // Test Backend Connection Button in Settings
    elements.testConnectionBtn.addEventListener('click', async () => {
      const testUrl = elements.backendUrlInput.value.trim() || 'http://localhost:5000';
      elements.testConnectionBtn.disabled = true;
      elements.testConnectionBtn.textContent = 'Pinging...';

      try {
        const res = await fetch(`${testUrl}/api/health`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        showToast(`Connected! Server v${data.version || '1.1'}. Supabase: ${data.hasSupabase ? 'Yes' : 'No'}`, 'success');
      } catch (err) {
        showToast(`Connection failed: Cannot reach ${testUrl}`, 'error');
      } finally {
        elements.testConnectionBtn.disabled = false;
        elements.testConnectionBtn.textContent = 'Test Ping';
      }
    });

    // Test Supabase Connection Button
    if (elements.testSupabaseBtn) {
      elements.testSupabaseBtn.addEventListener('click', async () => {
        const url = elements.supabaseUrlInput.value.trim();
        const key = elements.supabaseKeyInput.value.trim();

        if (!url || !key || isPlaceholder(url) || isPlaceholder(key)) {
          showToast('Please enter both Supabase URL and Anon Key', 'warning');
          return;
        }

        elements.testSupabaseBtn.disabled = true;
        elements.testSupabaseBtn.textContent = 'Connecting...';

        try {
          if (!window.supabase) {
            throw new Error('Supabase JS library not loaded');
          }
          const client = window.supabase.createClient(url, key);
          const { error } = await client.from('chats').select('id').limit(1);

          if (error && error.code !== 'PGRST116') {
            throw error;
          }

          showToast('⚡ Supabase Connected & verified successfully!', 'success');
        } catch (err) {
          showToast(`Supabase test: ${err.message || 'Connection failed'}`, 'error');
        } finally {
          elements.testSupabaseBtn.disabled = false;
          elements.testSupabaseBtn.textContent = 'Test Supabase';
        }
      });
    }

    // Save Settings
    elements.saveSettingsBtn.addEventListener('click', () => {
      state.backendUrl = elements.backendUrlInput.value.trim() || 'http://localhost:5000';
      state.apiKeyOverride = elements.apiKeyInput.value.trim();
      state.supabaseUrl = elements.supabaseUrlInput.value.trim();
      state.supabaseAnonKey = elements.supabaseKeyInput.value.trim();
      state.temperature = parseFloat(elements.temperatureSlider.value);
      state.stream = elements.streamToggle.checked;
      state.customSystemPrompt = elements.customSystemPrompt.value.trim();

      localStorage.setItem('gemini_backend_url', state.backendUrl);
      localStorage.setItem('gemini_api_key_override', state.apiKeyOverride);
      localStorage.setItem('gemini_supabase_url', state.supabaseUrl);
      localStorage.setItem('gemini_supabase_anon_key', state.supabaseAnonKey);
      localStorage.setItem('gemini_temperature', state.temperature.toString());
      localStorage.setItem('gemini_stream', state.stream.toString());
      localStorage.setItem('gemini_custom_system_prompt', state.customSystemPrompt);

      initSupabaseClient();
      closeSettingsModal();
      checkBackendHealth();
      showToast('Settings saved successfully', 'success');
    });
  }

  function autoResizeTextarea() {
    const input = elements.userInput;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
  }

  // --- Settings Modal Handlers ---
  function openSettingsModal() {
    loadSettingsIntoUI();
    elements.settingsModal.style.display = 'flex';
  }

  function closeSettingsModal() {
    elements.settingsModal.style.display = 'none';
  }

  // --- Toast Notifications ---
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  }

  // --- Chat Lifecycle & Storage ---
  function startNewChat(notify = true) {
    if (state.isStreaming && state.activeAbortController) {
      state.activeAbortController.abort();
    }

    state.currentChatId = 'chat_' + Date.now();
    state.messages = [];
    elements.chatFeed.innerHTML = '';
    elements.welcomeScreen.style.display = 'flex';
    elements.userInput.value = '';
    autoResizeTextarea();
    elements.sendBtn.disabled = true;
    renderHistoryList();

    if (notify) {
      showToast('New chat started', 'info');
    }
  }

  async function loadStoredChats() {
    // 1. If Supabase is connected, try to fetch chats from Supabase
    if (state.supabaseClient) {
      try {
        const { data, error } = await state.supabaseClient
          .from('chats')
          .select('*')
          .order('updated_at', { ascending: false });

        if (!error && Array.isArray(data) && data.length > 0) {
          state.chats = data.map(c => ({
            id: c.id,
            title: c.title,
            updatedAt: new Date(c.updated_at).getTime(),
            messages: []
          }));
          renderHistoryList();
          return;
        }
      } catch (err) {
        console.warn('Supabase chats fetch skipped/failed, using localStorage:', err.message);
      }
    }

    // 2. Fallback to localStorage
    try {
      const stored = localStorage.getItem('gemini_chat_sessions');
      if (stored) {
        state.chats = JSON.parse(stored);
      }
    } catch (e) {
      state.chats = [];
    }
    renderHistoryList();
  }

  function saveChatsToStorage() {
    localStorage.setItem('gemini_chat_sessions', JSON.stringify(state.chats));
  }

  async function updateCurrentChatInStorage() {
    if (state.messages.length === 0) return;

    const firstUserMsg = state.messages.find(m => m.role === 'user');
    const title = firstUserMsg ? firstUserMsg.content.substring(0, 36) + (firstUserMsg.content.length > 36 ? '...' : '') : 'New Conversation';

    const existingIndex = state.chats.findIndex(c => c.id === state.currentChatId);
    const chatData = {
      id: state.currentChatId,
      title: title,
      updatedAt: Date.now(),
      messages: state.messages
    };

    if (existingIndex >= 0) {
      state.chats[existingIndex] = chatData;
    } else {
      state.chats.unshift(chatData);
    }

    saveChatsToStorage();
    renderHistoryList();

    // Async sync to Supabase if connected
    if (state.supabaseClient) {
      try {
        await state.supabaseClient.from('chats').upsert({
          id: state.currentChatId,
          title: title,
          updated_at: new Date().toISOString()
        });
      } catch (e) {
        console.warn('Supabase chat upsert failed:', e);
      }
    }
  }

  async function switchChat(chatId) {
    const chat = state.chats.find(c => c.id === chatId);
    if (!chat) return;

    state.currentChatId = chat.id;
    elements.chatFeed.innerHTML = '';

    // If Supabase is connected, load messages from Supabase
    if (state.supabaseClient) {
      try {
        const { data, error } = await state.supabaseClient
          .from('messages')
          .select('*')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: true });

        if (!error && Array.isArray(data) && data.length > 0) {
          state.messages = data.map(m => ({
            role: m.role,
            content: m.content,
            timestamp: new Date(m.created_at).getTime()
          }));
        } else {
          state.messages = chat.messages || [];
        }
      } catch (err) {
        state.messages = chat.messages || [];
      }
    } else {
      state.messages = [...(chat.messages || [])];
    }

    if (state.messages.length === 0) {
      elements.welcomeScreen.style.display = 'flex';
    } else {
      elements.welcomeScreen.style.display = 'none';
      state.messages.forEach(msg => {
        appendMessageToDOM(msg.role, msg.content, false);
      });
      scrollToBottom();
    }

    renderHistoryList();
  }

  async function deleteChat(chatId, event) {
    event.stopPropagation();
    state.chats = state.chats.filter(c => c.id !== chatId);
    saveChatsToStorage();

    if (state.supabaseClient) {
      try {
        await state.supabaseClient.from('chats').delete().eq('id', chatId);
      } catch (e) {
        console.warn('Supabase chat deletion error:', e);
      }
    }

    if (state.currentChatId === chatId) {
      startNewChat(false);
    } else {
      renderHistoryList();
    }
    showToast('Conversation deleted', 'info');
  }

  function renderHistoryList() {
    elements.historyList.innerHTML = '';

    if (state.chats.length === 0) {
      elements.historyList.innerHTML = '<div class="history-empty-text">No saved conversations yet</div>';
      return;
    }

    state.chats.forEach(chat => {
      const item = document.createElement('div');
      item.className = `history-item ${chat.id === state.currentChatId ? 'active' : ''}`;
      item.onclick = () => switchChat(chat.id);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'history-title';
      titleSpan.textContent = chat.title || 'Untitled Chat';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'history-delete-btn';
      deleteBtn.title = 'Delete chat';
      deleteBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
      deleteBtn.onclick = (e) => deleteChat(chat.id, e);

      item.appendChild(titleSpan);
      item.appendChild(deleteBtn);
      elements.historyList.appendChild(item);
    });
  }

  // --- Export Conversation ---
  function exportConversation() {
    if (state.messages.length === 0) {
      showToast('No messages to export', 'warning');
      return;
    }

    let markdown = `# Gemini Chat Export - ${new Date().toLocaleString()}\n`;
    markdown += `**Model:** ${state.model} | **Persona:** ${PERSONAS[state.activePersona].name}\n\n---\n\n`;

    state.messages.forEach(m => {
      const sender = m.role === 'user' ? '### 👤 User' : '### 🤖 Gemini';
      markdown += `${sender}\n\n${m.content}\n\n---\n\n`;
    });

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gemini-chat-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Exported to Markdown', 'success');
  }

  // --- Message Submissions & LLM Streaming ---
  async function handleChatSubmit() {
    const text = elements.userInput.value.trim();
    if (!text || state.isStreaming) return;

    elements.userInput.value = '';
    autoResizeTextarea();
    elements.sendBtn.disabled = true;
    elements.welcomeScreen.style.display = 'none';

    // 1. Add User Message
    const userMsg = { role: 'user', content: text, timestamp: Date.now() };
    state.messages.push(userMsg);
    appendMessageToDOM('user', text);
    scrollToBottom();
    updateCurrentChatInStorage();

    // 2. Prepare for Assistant Response
    setStreamingState(true);
    elements.typingIndicator.style.display = 'flex';
    scrollToBottom();

    state.activeAbortController = new AbortController();

    let systemInstruction = PERSONAS[state.activePersona]?.systemPrompt || '';
    if (state.customSystemPrompt) {
      systemInstruction += '\n' + state.customSystemPrompt;
    }

    const historyPayload = state.messages.slice(0, -1).map(m => ({
      role: m.role,
      content: m.content
    }));

    const firstMsg = state.messages.find(m => m.role === 'user');
    const chatTitle = firstMsg ? firstMsg.content.substring(0, 36) : 'New Chat';

    const payload = {
      message: text,
      history: historyPayload,
      model: state.model,
      systemInstruction: systemInstruction,
      temperature: state.temperature,
      stream: state.stream,
      chatId: state.currentChatId,
      chatTitle: chatTitle
    };

    const headers = {
      'Content-Type': 'application/json'
    };
    if (state.apiKeyOverride) {
      headers['Authorization'] = `Bearer ${state.apiKeyOverride}`;
    }

    try {
      const response = await fetch(`${state.backendUrl}/api/chat`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
        signal: state.activeAbortController.signal
      });

      elements.typingIndicator.style.display = 'none';

      if (!response.ok) {
        let errData;
        try {
          errData = await response.json();
        } catch (_) {
          errData = { error: `Server error: HTTP ${response.status}` };
        }
        throw new Error(errData.error || errData.details || `HTTP error ${response.status}`);
      }

      if (state.stream) {
        // --- SSE Streaming Response ---
        const { messageBubble, contentElem, row } = createModelMessageBubble();
        let fullText = '';

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;

            const dataStr = trimmed.replace(/^data:\s*/, '');
            if (dataStr === '[DONE]') {
              break;
            }

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              if (parsed.text) {
                fullText += parsed.text;
                renderMarkdownContent(contentElem, fullText, true);
                scrollToBottom();
              }
            } catch (jsonErr) {
              // Ignore partial chunk parsing
            }
          }
        }

        renderMarkdownContent(contentElem, fullText, false);
        attachMessageActions(row, fullText);
        state.messages.push({ role: 'model', content: fullText, timestamp: Date.now() });
        updateCurrentChatInStorage();
      } else {
        // --- Standard JSON Response ---
        const data = await response.json();
        const fullText = data.reply || '';
        appendMessageToDOM('model', fullText);
        state.messages.push({ role: 'model', content: fullText, timestamp: Date.now() });
        updateCurrentChatInStorage();
        scrollToBottom();
      }
    } catch (error) {
      elements.typingIndicator.style.display = 'none';

      if (error.name === 'AbortError') {
        console.log('Stream generation aborted by user.');
      } else {
        console.error('Chat error:', error);
        appendErrorMessage(error.message);
      }
    } finally {
      setStreamingState(false);
      state.activeAbortController = null;
      elements.userInput.focus();
    }
  }

  function setStreamingState(isStreaming) {
    state.isStreaming = isStreaming;
    elements.stopBtn.style.display = isStreaming ? 'inline-flex' : 'none';
    elements.sendBtn.disabled = isStreaming || elements.userInput.value.trim() === '';
  }

  // --- DOM Message Rendering ---
  function appendMessageToDOM(role, content, animate = true) {
    const row = document.createElement('div');
    row.className = `message-row ${role}`;
    if (!animate) row.style.animation = 'none';

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = `avatar ${role === 'user' ? 'user-avatar' : 'bot-avatar'}`;
    if (role === 'user') {
      avatar.textContent = 'U';
    } else {
      avatar.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" fill="url(#gemini-grad-feed)" />
          <defs>
            <linearGradient id="gemini-grad-feed" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
              <stop stop-color="#4E95FF" />
              <stop offset="0.5" stop-color="#9E54FF" />
              <stop offset="1" stop-color="#FF5B99" />
            </linearGradient>
          </defs>
        </svg>
      `;
    }

    // Bubble Wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'message-bubble-wrapper';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (role === 'user') {
      bubble.textContent = content;
    } else {
      renderMarkdownContent(bubble, content, false);
    }

    wrapper.appendChild(bubble);

    if (role === 'model') {
      attachMessageActions(wrapper, content);
    }

    row.appendChild(avatar);
    row.appendChild(wrapper);
    elements.chatFeed.appendChild(row);
  }

  function createModelMessageBubble() {
    const row = document.createElement('div');
    row.className = 'message-row model';

    const avatar = document.createElement('div');
    avatar.className = 'avatar bot-avatar';
    avatar.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" fill="url(#gemini-grad-stream)" />
        <defs>
          <linearGradient id="gemini-grad-stream" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop stop-color="#4E95FF" />
            <stop offset="0.5" stop-color="#9E54FF" />
            <stop offset="1" stop-color="#FF5B99" />
          </linearGradient>
        </defs>
      </svg>
    `;

    const wrapper = document.createElement('div');
    wrapper.className = 'message-bubble-wrapper';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    wrapper.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(wrapper);
    elements.chatFeed.appendChild(row);

    return { messageBubble: bubble, contentElem: bubble, row: wrapper };
  }

  function renderMarkdownContent(element, markdownText, isStreaming) {
    if (typeof marked !== 'undefined') {
      element.innerHTML = marked.parse(markdownText);
    } else {
      element.textContent = markdownText;
    }

    if (isStreaming) {
      const cursor = document.createElement('span');
      cursor.className = 'streaming-cursor';
      element.appendChild(cursor);
    }

    enhanceCodeBlocks(element);
  }

  function enhanceCodeBlocks(container) {
    const preBlocks = container.querySelectorAll('pre:not(.enhanced)');
    preBlocks.forEach(pre => {
      pre.classList.add('enhanced');
      const code = pre.querySelector('code');
      const codeText = code ? code.innerText : pre.innerText;

      let lang = 'code';
      if (code && code.className) {
        const match = code.className.match(/language-(\w+)/);
        if (match) lang = match[1];
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';

      const header = document.createElement('div');
      header.className = 'code-header';
      header.innerHTML = `
        <span class="code-lang">${lang}</span>
        <button class="copy-code-btn" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span>Copy</span>
        </button>
      `;

      const copyBtn = header.querySelector('.copy-code-btn');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(codeText).then(() => {
          copyBtn.innerHTML = `<span>✅ Copied!</span>`;
          setTimeout(() => {
            copyBtn.innerHTML = `
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy</span>
            `;
          }, 2000);
        });
      });

      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(pre);
    });
  }

  function attachMessageActions(wrapper, contentText) {
    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.innerHTML = `<span>${timeStr}</span>`;

    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-btn';
    copyBtn.title = 'Copy response';
    copyBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    `;
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(contentText).then(() => {
        showToast('Response copied to clipboard', 'success');
      });
    };

    const speakBtn = document.createElement('button');
    speakBtn.className = 'action-btn';
    speakBtn.title = 'Read aloud';
    speakBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>
    `;
    speakBtn.onclick = () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(contentText.replace(/[#*`_]/g, ''));
        window.speechSynthesis.speak(utterance);
        showToast('Reading response aloud...', 'info');
      } else {
        showToast('Speech synthesis not supported in this browser', 'warning');
      }
    };

    actions.appendChild(copyBtn);
    actions.appendChild(speakBtn);
    meta.appendChild(actions);
    wrapper.appendChild(meta);
  }

  function appendErrorMessage(errorMsg) {
    const errorCard = document.createElement('div');
    errorCard.className = 'message-row model';
    errorCard.innerHTML = `
      <div class="avatar bot-avatar" style="border-color: rgba(239, 68, 68, 0.4);">⚠️</div>
      <div class="message-bubble-wrapper">
        <div class="message-bubble" style="border-color: rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.08);">
          <strong style="color: #fca5a5;">Gemini Communication Error</strong>
          <p style="margin-top: 6px; color: #fecaca; font-size: 0.88rem;">${errorMsg}</p>
          <div style="margin-top: 10px;">
            <button class="btn btn-sm btn-secondary" onclick="document.getElementById('settings-btn').click()">
              Check Key &amp; Server Settings
            </button>
          </div>
        </div>
      </div>
    `;
    elements.chatFeed.appendChild(errorCard);
    scrollToBottom();
  }

  function scrollToBottom() {
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
