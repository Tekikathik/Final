# Priya on LiveKit

The Aditya University admission voice agent, rebuilt on **LiveKit Agents**. LiveKit
natively handles the streaming STT, turn detection/endpointing, and streamed LLM→TTS
overlap you hand-built in the Node version — so this is far less code and lower latency.

**Stack:** Sarvam STT + TTS (Indian languages) · Groq llama-70b LLM (or local Ollama) · LiveKit orchestration.

---

## 1. What you must add before it runs
Your `.env` already has the Sarvam + Groq keys and the LiveKit **API key**. You still need:
- **`LIVEKIT_API_SECRET`** — the secret paired with your key
- **`LIVEKIT_URL`** — `wss://<your-project>.livekit.cloud`

Both are in the **LiveKit Cloud dashboard → Settings → Keys**. (Free account at https://cloud.livekit.io.)

## 2. Install (Python 3.9+)
```bash
cd priya-livekit
python -m venv .venv
.venv\Scripts\activate          # Windows  (use: source .venv/bin/activate on Mac/Linux)
pip install -r requirements.txt
python agent.py download-files  # one-time: fetch model files (turn detector, etc.)
```

## 3. Try it immediately (no phone needed)
```bash
python agent.py console
```
This talks to Priya through your **computer mic** — the fastest way to hear the Telugu
voice + latency. Speak Telugu/English; she should reply in the same language.

## 4. Run as a worker (for LiveKit rooms / web / telephony)
```bash
python agent.py dev
```
Then connect a client — easiest is the **LiveKit Agents Playground**
(https://agents-playground.livekit.io) pointed at your project, or the
[Sandbox](https://cloud.livekit.io) frontend.

## 5. Phone calls (telephony)
Real inbound/outbound phone calls need **LiveKit SIP** (it replaces your Twilio Media
Streams setup):
1. In LiveKit Cloud → **Telephony**, create a SIP trunk (you can bring your existing
   Twilio number, or buy one via LiveKit/Telnyx).
2. Create a **dispatch rule** that routes calls to this agent.
3. Outbound: use the LiveKit `create_sip_participant` API to dial a number into a room.

See: https://docs.livekit.io/agents/start/telephony/

---

## Notes & tuning
- **LLM:** defaults to Groq llama-70b. Set `LLM_PROVIDER=local` in `.env` to use your
  local Ollama 3B instead (keep Ollama running).
- **Voice:** `SARVAM_SPEAKER=anushka` (a bulbul:v3 female voice). If that errors, pick a
  valid one from the Sarvam TTS plugin docs:
  https://docs.livekit.io/agents/models/tts/sarvam/ — change `SARVAM_SPEAKER` and restart.
- **Language:** `TTS_LANGUAGE=te-IN` is the primary spoken language. The STT auto-detects
  per turn; for clean per-turn TTS language switching you may set the TTS language
  dynamically — start with te-IN and refine.
- **Tools:** `agent.py` has `save_detail`, `get_course_package`, `get_scholarships` as
  working examples. `get_course_package`/`get_scholarships` are **stubs** — wire them to
  your real data (port the logic from the Node `backend/services/agentTools.js`).
- **Turn detection:** `turn_detection="stt"` + `min_endpointing_delay=0.07` lets Sarvam's
  STT drive endpointing (~70ms) — this is the fast, accurate version of what you built
  with RMS silence detection.

## Why this should beat the Node version on latency
- Streaming STT→LLM→TTS overlap is built in (no manual sentence-pipelining).
- Endpointing is model-driven, not a fixed silence timer.
- No translate hop — the LLM replies in-language directly.
- Runs the LLM on Groq (cloud, ~1s) instead of a cold-prone local 3B.
