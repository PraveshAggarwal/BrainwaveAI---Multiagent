# 🧠 Brainwave AI — Multi-Agent Research System

A multi-agent AI pipeline that takes any research topic and automatically searches the web, scrapes content, writes a structured report, and critiques it — all streamed live to a clean chat-style frontend.

---

## 🚀 What It Does

You type a topic. Four specialized AI agents collaborate in sequence to produce a polished, scored research report:

```
User Input → Search Agent → Reader Agent → Writer Agent → Critic Agent → Final Report
```

Each step streams live to the frontend so you can watch the pipeline progress in real time.

---

## 🤖 The Four Agents

### 🔍 Search Agent
Uses the **Tavily** search API to find recent, reliable sources across the web. Returns titles, URLs, and content snippets relevant to the topic. Configured for `advanced` depth with up to 4 results.

### 📄 Reader Agent
Takes the most relevant URL from the search results and scrapes its full content using **BeautifulSoup**. Strips away scripts, styles, navbars and footers — returning only clean readable text for the writer to use.

### ✍️ Writer Agent
A **LangChain LCEL chain** (prompt → Gemini LLM → output parser) that takes the combined search + scraped content and writes a structured research report with:
- Introduction
- Key Findings (minimum 3 points)
- Conclusion
- Sources

### 🧐 Critic Agent
Another **LCEL chain** that reviews the written report and responds with a strict evaluation:
- Score out of 10
- Strengths
- Areas to Improve
- One-line verdict

---

## 🏗️ Project Structure

```
MultiAgent/
├── agents.py          # LLM setup, agent builders, writer & critic chains
├── api.py             # Flask backend — runs pipeline, streams SSE to frontend
├── pipeline.py        # Standalone CLI pipeline (for testing without frontend)
├── tools.py           # LangChain tools: web_search (Tavily) + scrape_url (BS4)
├── .env               # API keys (never commit this)
├── requirements.txt   # Python dependencies
└── frontend/
    ├── index.html     # Chat UI
    ├── css/style.css  # Styling
    └── js/app.js      # Frontend logic — SSE handling, rendering
```

---

## ⚙️ Tech Stack

| Layer | Technology |
|---|---|
| LLM | Google Gemini (via `langchain-google-genai`) |
| Agent Framework | LangChain (`create_agent`, LCEL chains) |
| Web Search | Tavily API |
| Web Scraping | BeautifulSoup4 + Requests |
| Backend API | Flask + Flask-CORS |
| Streaming | Server-Sent Events (SSE) |
| Frontend | Vanilla HTML/CSS/JS |
| Markdown Rendering | marked.js + highlight.js |

---

## 🛠️ Setup & Installation

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd MultiAgent
```

### 2. Create a virtual environment

```bash
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure API keys

Create a `.env` file in the root directory:

```env
GOOGLE_API_KEY=your_google_api_key_here
TAVILY_API_KEY=your_tavily_api_key_here
```

- Get a free Google Gemini API key → https://aistudio.google.com/app/apikey
- Get a free Tavily API key → https://app.tavily.com

### 5. Run the backend

```bash
python api.py
```

The API server starts at `http://127.0.0.1:5000`

### 6. Open the frontend

Open `frontend/index.html` directly in your browser — no build step needed.

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/research` | Accepts `{ "topic": "..." }`, streams SSE pipeline events |
| `GET` | `/api/health` | Health check — returns `{ "status": "ok" }` |

### SSE Event Types

| Event | Payload | Description |
|---|---|---|
| `step_start` | `step, title, description` | Agent started |
| `step_done` | `step, content` | Agent finished with output |
| `step_error` | `step, error` | Agent failed with error message |
| `rate_limit_error` | `step, retry_after` | Free-tier quota exhausted |
| `pipeline_done` | `report, feedback` | All agents done, final results |
| `pipeline_error` | `message` | Unrecoverable pipeline failure |

---

## ⚠️ Free Tier & Rate Limits

This project uses the **free tier** of the Google Gemini API. The free tier has per-minute and per-day request limits.

If the limit is exhausted, the frontend will show a friendly message with the estimated time the quota resets (when available from the API error response). Simply wait until that time and try again.

---

## 🖥️ Running the CLI Pipeline (No Frontend)

You can also run the pipeline directly in the terminal:

```bash
python pipeline.py
```

It will prompt you for a topic and print each agent's output to the console.

---

## 📦 Dependencies Overview

```
langchain                  # Core agent + chain framework
langchain-core             # LCEL, prompts, output parsers
langchain-google-genai     # Gemini LLM integration
google-generativeai        # Google AI SDK
langchain-community        # Community tools
tavily-python              # Tavily search client
beautifulsoup4             # HTML parsing / scraping
requests                   # HTTP client
lxml                       # HTML/XML parser
flask                      # Backend API server
flask-cors                 # Cross-origin requests
python-dotenv              # .env file loader
pydantic                   # Data validation
rich                       # Pretty terminal output
tenacity                   # Retry logic
```
