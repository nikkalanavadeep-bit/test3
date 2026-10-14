# 🤖 Gemini LLM Chatbot with Supabase Integration

An ultra-modern, full-stack AI chatbot powered by Google's Gemini models (`gemini-1.5-flash`, `gemini-1.5-pro`, `gemini-2.0-flash`) and **Supabase** for persistent chat storage. Built with a strict architectural differentiation between the **frontend** and **backend** folders.

---

## 📁 Project Architecture & Folder Differentiation

The workspace is organized into two completely decoupled tiers with their own `.env` configuration files:

```
├── backend/                       # 🟢 BACKEND SERVER (Node.js & Express)
│   ├── .env                       # Backend secrets (GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY)
│   ├── .env.example               # Backend environment template
│   ├── package.json               # Backend dependencies (@google/generative-ai, @supabase/supabase-js)
│   └── server.js                  # Express API server with SSE streaming & Supabase endpoints
│
├── frontend/                      # 🟣 FRONTEND CLIENT (Vanilla Web Stack)
│   ├── .env                       # Frontend public variables (SUPABASE_URL, SUPABASE_ANON_KEY)
│   ├── .env.example               # Frontend environment template
│   ├── index.html                 # Semantic HTML, Google Fonts, and Supabase client CDN
│   ├── style.css                  # Obsidian glassmorphic design & responsive UI
│   └── app.js                     # Client state, Server-Sent Events (SSE), Supabase sync & Markdown
│
├── supabase_schema.sql            # Ready-to-run SQL script for Supabase tables (chats & messages)
├── package.json                   # Root orchestrator scripts (run dev, start, etc.)
└── README.md                      # Documentation & setup guide
```

---

## 🔑 Environment Variables Specification

### 1. `backend/.env` (Server Secrets)
```env
# Google Gemini API Key
GEMINI_API_KEY=AIzaSy...your-gemini-key

# Server Port & Default Model
PORT=5000
DEFAULT_MODEL=gemini-1.5-flash

# Supabase Server Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key-here
```

### 2. `frontend/.env` (Client Configuration)
```env
# Supabase Client Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key-here

# Backend API Endpoint
BACKEND_URL=http://localhost:5000
DEFAULT_MODEL=gemini-1.5-flash

# Aliases (for Vite / bundler compatibility)
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key-here
```

---

## ⚡ Supabase Setup & Migrations

### Single-Command Database Migration

Execute all table creations, indexes, triggers, and RLS policies with a single command:

```bash
npm run db:migrate
```

*(You will be prompted to enter your Supabase database password, or you can run `npm run db:migrate -- <your-password>` or set `SUPABASE_DB_PASSWORD` in `backend/.env`).*

#### Alternative: Supabase CLI
```bash
npx supabase db push
```

#### Alternative: Manual SQL Execution
If you prefer using the Supabase Dashboard, copy [`supabase/migrations/20261014101323_create_chatbot_tables.sql`](supabase/migrations/20261014101323_create_chatbot_tables.sql) and paste it into **SQL Editor** -> **New Query** -> **Run**.

---

## 🚀 Quick Start Guide

### Step 1: Add your Gemini API Key
1. Get a free Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Open [`backend/.env`](backend/.env) and set your key:
   ```env
   GEMINI_API_KEY=AIzaSy...
   ```
   *(You can also configure/test keys directly in the web UI via the Settings modal).*

### Step 2: Start the Backend Server
```bash
npm start
```
*(or run `cd backend && npm start`)*

The server will display:
```text
🤖 Gemini Chatbot Backend Server Running!
📡 URL: http://localhost:5000
📁 Frontend: C:\...\frontend
🔑 Gemini Key: Configured in .env
⚡ Supabase: Connected (https://your-project.supabase.co)
```

### Step 3: Open the Frontend
Open your browser at:
👉 **`http://localhost:5000`**  
*(Or open [`frontend/index.html`](frontend/index.html) directly via VS Code Live Server).*

---

## 📡 API Endpoints Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check & verifies Gemini key and Supabase status |
| `GET` | `/api/config` | Returns safe public variables (Supabase URL & anon key) |
| `GET` | `/api/models` | Returns available Gemini models with context limits |
| `POST` | `/api/chat` | Main chat endpoint. Supports SSE streaming and persists to Supabase |
| `GET` | `/api/chats` | Lists chat sessions from Supabase |
| `POST` | `/api/chats` | Creates or updates a chat session in Supabase |
| `DELETE` | `/api/chats/:id` | Deletes a chat session from Supabase |
| `GET` | `/api/chats/:id/messages` | Retrieves messages for a chat from Supabase |
