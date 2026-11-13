"""
Brainwave AI — Flask API Backend
Streams the 4-step research pipeline to the frontend via Server-Sent Events.

Run:
    python api.py

Endpoints:
    POST /api/research   { "topic": "..." }  →  SSE stream
    GET  /api/health                         →  JSON status
"""

from flask import Flask, request, Response, jsonify
from flask_cors import CORS
import json
import traceback
import re
import time
from agents import build_search_agent, build_reader_agent, writer_chain, critic_chain

# ── App Setup ─────────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app)  # allow the frontend (file:// or any origin) to call us


# ── SSE helper ────────────────────────────────────────────────────────────────

def sse(event_type: str, **fields) -> str:
    """Format one Server-Sent Event line."""
    payload = {"type": event_type, **fields}
    return f"data: {json.dumps(payload)}\n\n"


def parse_rate_limit_error(exc: Exception) -> dict | None:
    """
    If exc is a Gemini / Google API rate-limit (429) error, return
    { "retry_after": <ISO-string or None> }, else return None.
    """
    msg = str(exc)
    # google-generativeai raises grpc ResourceExhausted or HTTP 429
    if "429" not in msg and "ResourceExhausted" not in msg and "quota" not in msg.lower():
        return None

    retry_after = None
    # try to pull a retry delay from the error message (e.g. "retry_delay { seconds: 60 }")
    m = re.search(r'retry_delay\s*\{\s*seconds:\s*(\d+)', msg)
    if m:
        retry_after = time.strftime(
            "%H:%M:%S", time.localtime(time.time() + int(m.group(1)))
        )
    return {"retry_after": retry_after}


# ── Pipeline generator (yields SSE events) ────────────────────────────────────

def run_pipeline(topic: str):
    """
    Execute the 4-agent research pipeline and yield SSE events that the
    frontend listens to:

        step_start   → { step, title, description }
        step_done    → { step, content }
        step_error   → { step, error }
        pipeline_done  → { report, feedback }
        pipeline_error → { message }
    """

    search_content = None
    reader_content = None
    report = None
    feedback = None

    # ── Step 1 — Search Agent ─────────────────────────────────────────────
    yield sse("step_start",
              step=1,
              title="Search Agent",
              description="Searching the web for reliable information…")
    try:
        search_agent = build_search_agent()
        result = search_agent.invoke({
            "messages": [
                ("user",
                 f"Find recent, reliable and detailed information about: {topic}")
            ]
        })
        search_content = result["messages"][-1].content
        yield sse("step_done", step=1, content=search_content)
    except Exception as exc:
        rl = parse_rate_limit_error(exc)
        if rl is not None:
            yield sse("rate_limit_error", step=1, **rl)
            return
        yield sse("step_error", step=1, error=str(exc))
        yield sse("pipeline_error", message=f"Search Agent failed: {exc}")
        traceback.print_exc()
        return

    # ── Step 2 — Reader Agent ─────────────────────────────────────────────
    yield sse("step_start",
              step=2,
              title="Reader Agent",
              description="Scraping top resources for deeper content…")
    try:
        reader_agent = build_reader_agent()
        result = reader_agent.invoke({
            "messages": [
                ("user",
                 f"Based on the following search results about '{topic}', "
                 f"pick the most relevant URL and scrape it for deeper content.\n\n"
                 f"Search Results:\n{search_content[:800]}")
            ]
        })
        reader_content = result["messages"][-1].content
        yield sse("step_done", step=2, content=reader_content)
    except Exception as exc:
        rl = parse_rate_limit_error(exc)
        if rl is not None:
            yield sse("rate_limit_error", step=2, **rl)
            return
        yield sse("step_error", step=2, error=str(exc))
        yield sse("pipeline_error", message=f"Reader Agent failed: {exc}")
        traceback.print_exc()
        return

    # ── Step 3 — Writer Chain ─────────────────────────────────────────────
    yield sse("step_start",
              step=3,
              title="Writer Agent",
              description="Drafting a polished research report…")
    try:
        research_combined = (
            f"SEARCH RESULTS:\n{search_content}\n\n"
            f"DETAILED SCRAPED CONTENT:\n{reader_content}"
        )
        report = writer_chain.invoke({
            "topic": topic,
            "research": research_combined,
        })
        yield sse("step_done", step=3, content=report)
    except Exception as exc:
        rl = parse_rate_limit_error(exc)
        if rl is not None:
            yield sse("rate_limit_error", step=3, **rl)
            return
        yield sse("step_error", step=3, error=str(exc))
        yield sse("pipeline_error", message=f"Writer Agent failed: {exc}")
        traceback.print_exc()
        return

    # ── Step 4 — Critic Chain ─────────────────────────────────────────────
    yield sse("step_start",
              step=4,
              title="Critic Agent",
              description="Reviewing and scoring the report…")
    try:
        feedback = critic_chain.invoke({
            "report": report,
        })
        yield sse("step_done", step=4, content=feedback)
    except Exception as exc:
        rl = parse_rate_limit_error(exc)
        if rl is not None:
            yield sse("rate_limit_error", step=4, **rl)
            return
        yield sse("step_error", step=4, error=str(exc))
        yield sse("pipeline_error", message=f"Critic Agent failed: {exc}")
        traceback.print_exc()
        return

    # ── All Done ──────────────────────────────────────────────────────────
    yield sse("pipeline_done", report=report, feedback=feedback)


# ══════════════════════════════════════════════════════════════════════════════
#  ROUTES
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/research", methods=["POST"])
def research():
    """Accept a topic and stream the pipeline as SSE."""
    data = request.get_json(silent=True) or {}
    topic = data.get("topic", "").strip()

    if not topic:
        return jsonify({"error": "Please provide a research topic."}), 400

    return Response(
        run_pipeline(topic),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",          # disable nginx buffering
            "Connection": "keep-alive",
        },
    )


@app.route("/api/health", methods=["GET"])
def health():
    """Simple health check."""
    return jsonify({"status": "ok", "service": "Brainwave AI API"})


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  🧠 Brainwave AI API Server")
    print("  → http://127.0.0.1:5000")
    print("  → Open frontend/index.html in your browser")
    print("=" * 60 + "\n")

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True,
        threaded=True,       # handle concurrent SSE streams
    )
