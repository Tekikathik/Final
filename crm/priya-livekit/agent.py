"""
Priya — Aditya University admission voice agent, rebuilt on LiveKit Agents.

Why LiveKit: it handles the hard parts you hand-built in the Node version — live
streaming STT, turn detection / endpointing, and streamed LLM→TTS overlap — natively.
The Sarvam plugin does STT + TTS (11 Indian languages); the LLM is Groq llama-70b
(fast, strong Telugu) via the OpenAI-compatible plugin. Swap to local Ollama by
flipping LLM_PROVIDER=local in .env.

Run:
    python agent.py console     # talk to it from your terminal mic
    python agent.py dev         # run the worker (for LiveKit rooms / telephony)
"""
import os
import re
import json
import time
import asyncio
import logging
from dotenv import load_dotenv

from livekit.agents import (JobContext, WorkerOptions, cli, function_tool, RunContext,
                            metrics, APIConnectOptions)
from livekit.agents.voice import Agent, AgentSession
from livekit.agents.voice.agent_session import SessionConnectOptions
from livekit.agents.llm import ChatMessage, ChatChunk, ChatContext
from livekit.plugins import sarvam, openai

import university_data as udata  # local Aditya University knowledge + lookup helpers
from reporter import Reporter    # pushes live transcript/collected/status to the Node dashboard
from latency import LatencyTracker  # logs per-turn EOU/LLM/TTS latency to latency_log.csv
from translate import translate_out, prewarm as translate_prewarm, aclose as translate_aclose  # Sarvam translate-out

load_dotenv()
logger = logging.getLogger("priya")
logger.setLevel(logging.INFO)

# LiveKit Cloud "session recording" uploads traces/logs/audio to its observability endpoint.
# On a weak uplink those POSTs time out and spam the console with OpenTelemetry tracebacks
# (non-fatal). Silence them. NOTE: to actually stop the uploads — which compete with the live
# call audio for your uplink and can make the voice break — disable Agent session recording in
# the LiveKit Cloud dashboard (Project → Settings → Agents).
logging.getLogger("opentelemetry").setLevel(logging.CRITICAL)

# ── Config from .env ─────────────────────────────────────────────────────────
LLM_PROVIDER   = os.getenv("LLM_PROVIDER", "groq")          # "groq" | "local"
# Nemotron (via OpenRouter) is far more verbose than the other models — it dumps bullet lists and
# multi-sentence paragraphs. When it's the active model we append an extra, blunt style block.
IS_NEMOTRON    = (LLM_PROVIDER == "openrouter"
                  and "nemotron" in os.getenv("OPENROUTER_MODEL", "nvidia/nemotron-3-super-120b-a12b:free").lower())
SARVAM_SPEAKER = os.getenv("SARVAM_SPEAKER", "ritu")        # bulbul:v3 female voice
TTS_LANGUAGE   = os.getenv("TTS_LANGUAGE", "te-IN")         # starting / fallback spoken language
TTS_PACE       = float(os.getenv("TTS_PACE", "1.15"))
# Languages this deployment will actually SPEAK. STT auto-detects each turn and we
# switch the Sarvam voice to match — but only within this allowlist, so a mis-detect
# (e.g. Telugu heard as Odia on a short clip) doesn't flip the voice to a wrong language.
TTS_ALLOWED    = {l.strip() for l in os.getenv("ALLOWED_LANGUAGES", "te-IN,hi-IN,en-IN").split(",") if l.strip()}

# ── Language mode ────────────────────────────────────────────────────────────
# English-only by default. Flip MULTILANG=true (in .env) later to auto-detect the
# caller's language and switch the STT, the voice, AND the prompt to match per turn.
MULTILANG      = os.getenv("MULTILANG", "false").lower() == "true"
STT_LANGUAGE   = "unknown" if MULTILANG else "en-IN"        # auto-detect vs forced English
# The opening line is a fixed English greeting, so start with the English voice either way.
# In multilang mode the voice then switches to the caller's language on their first reply.
TTS_START_LANG = "en-IN"

# ── Translate-OUT ────────────────────────────────────────────────────────────
# When TRANSLATE_OUT=true, the LLM replies in ENGLISH and each sentence is localised
# into the caller's detected language by Sarvam (mayura:v1) right before TTS — more
# natural Indic phrasing than the LLM's direct output. Needs MULTILANG=true (so the
# caller's language is detected and the voice switches to it). Costs ~0.3–0.7s/sentence.
TRANSLATE_OUT  = os.getenv("TRANSLATE_OUT", "false").lower() == "true"
TRANSLATE_MODE = os.getenv("TRANSLATE_MODE", "modern-colloquial")
TRANSLATE_GENDER = os.getenv("TRANSLATE_GENDER", "Female")

if TRANSLATE_OUT:
    # The LLM COMPOSES in English; Sarvam localises it into the caller's language before TTS.
    # Critical: this is an internal pipeline detail — Priya must behave as if she speaks the
    # caller's language fluently, and must NEVER tell the caller she "only speaks English".
    LANGUAGE_BLOCK = (
        "- Compose every reply in plain, simple English — one short spoken sentence at a time.\n"
        "  Your English is automatically converted into the caller's own language before it is\n"
        "  spoken, so to the caller you ARE speaking their language fluently.\n"
        "- NEVER say or imply you 'only speak English'. NEVER apologise for language. NEVER offer\n"
        "  a different agent/counsellor because of language. If the caller asks whether you speak\n"
        "  Telugu/Hindi/Tamil/etc., warmly say YES and simply continue helping.\n"
        "- Keep proper nouns and technical terms as-is (B.Tech, CSE, NAAC, ₹ amounts, exam names)."
    )
elif MULTILANG:
    LANGUAGE_BLOCK = (
        "- Start in English. The moment the student uses Hindi, Telugu or Tamil (even one word),\n"
        "  switch to THAT language and stay in it for the rest of the call.\n"
        "- Talk the natural, modern CODE-MIXED way urban Indians actually speak: the local\n"
        "  language in its OWN script, with everyday English words kept in English. Example —\n"
        "  Hindi: 'अच्छा, तो आपको B.Tech in CSE में interest है? Campus visit करना चाहेंगे?'\n"
        "  Telugu: 'మంచిది, మీకు computer science లో interest ఉందా? Fee details కావాలా?'\n"
        "- Keep common/technical English words in English (fee, campus, B.Tech, CSE, percentage,\n"
        "  admission, counselling, deadline, scholarship). NEVER romanize Hindi/Telugu/Tamil —\n"
        "  always native script. Numbers as plain digits; money as ₹ (e.g. ₹45,000).\n"
        "- Mirror the student's language AND how much they mix in English. One short, natural\n"
        "  spoken sentence at a time. Warm, friendly, respectful throughout."
    )
else:
    LANGUAGE_BLOCK = (
        "- Speak ONLY in English for the entire call, no matter what language the student uses.\n"
        "- Use simple, clear, conversational English. Friendly, respectful tone; mirror their formality."
    )

# Language-name keywords (in English + native scripts) → language code, for honouring an
# EXPLICIT request like "speak in Telugu" / "హిందీలో మాట్లాడండి" / "अंग्रेजी में बात करो".
LANG_NAMES = {
    "te-IN": ["telugu", "తెలుగు", "तेलुगु", "तेलुगू"],
    "hi-IN": ["hindi", "हिंदी", "హిందీ", "हिन्दी"],
    "ta-IN": ["tamil", "தமிழ்", "तमिल", "తమిళ"],
    "kn-IN": ["kannada", "ಕನ್ನಡ", "కన్నడ", "कन्नड"],
    "ml-IN": ["malayalam", "മലയാളം", "మలయాళం", "मलयालम"],
    "mr-IN": ["marathi", "मराठी", "మరాఠీ"],
    "bn-IN": ["bengali", "bangla", "বাংলা", "বেঙ্গলি", "बंगाली"],
    "gu-IN": ["gujarati", "ગુજરાતી", "గుజరాతీ", "गुजराती"],
    "pa-IN": ["punjabi", "ਪੰਜਾਬੀ", "పంజాబీ", "पंजाबी"],
    "od-IN": ["odia", "oriya", "ଓଡ଼ିଆ", "ఒడియా"],
    "en-IN": ["english", "इंग्लिश", "अंग्रेज", "ఇంగ్లీష్", "ఇంగ్లిష్", "ఆంగ్ల", "ইংরেজি"],
}
# Words that signal the caller is REQUESTING a language (not just mentioning one).
LANG_REQUEST_HINTS = ["speak", "talk", "converse", "switch", "change", "language", " in ",
                      "మాట్లాడ", "లో ", "बात", "बोल", " में ", "பேசு", "মধ্যে", "kannin"]

# ── Outbound-call context — fill per deployment (or inject per call from the CRM) ─
AGENT_NAME       = os.getenv("AGENT_NAME", "Priya")
UNIVERSITY_NAME  = os.getenv("UNIVERSITY_NAME", "Aditya University")
ACADEMIC_YEAR    = os.getenv("ACADEMIC_YEAR", "2026-27")
DEFAULT_LANGUAGE = os.getenv("DEFAULT_LANGUAGE", "English")
# Per-call: the prospect's name from the enquiry (blank in console testing).
STUDENT_NAME     = os.getenv("STUDENT_NAME", "")
# Course knowledge lives in university_data.py, served via lookup TOOLS (exact, not RAG).
# NOTE: kept SHORT on purpose — each tool already carries its own description in the tool
# schema the model receives; re-listing them here doubled the prompt cost for no gain.
KNOWLEDGE_BASE = (
    "Do NOT answer factual questions from memory — call the matching lookup tool and speak "
    "ONLY what it returns. Branch flow: list_branches FIRST, then list_programs(branch) for "
    "specialisations. If a tool says a value isn't available, tell the caller a counsellor "
    "will follow up. Never guess fees, cutoffs, scholarships or placement numbers."
)
_student_ref = STUDENT_NAME or "the student who enquired with us"


# Cap the reply length. gpt-oss (reasoning) otherwise dumps the WHOLE flow as one 300-600
# token wall every turn — which burns the per-minute token budget (→ 429s) and makes Priya
# monologue for 20+ seconds. A hard cap keeps replies to ~one short answer + one question.
MAX_REPLY_TOKENS = int(os.getenv("MAX_REPLY_TOKENS", "160"))

# Cap what's actually SPOKEN per turn (characters). Even within the token cap, a long
# info-dump (e.g. a full fee breakdown) becomes a 20-30s audio clip — and a long clip
# streamed from a laptop over jittery wifi is exactly what stutters/breaks. Trimming the
# spoken reply to whole sentences keeps every clip short (~10-12s max) and resilient.
MAX_SPOKEN_CHARS = int(os.getenv("MAX_SPOKEN_CHARS", "280"))


_ENV_KEY = {"groq": "GROQ_API_KEY", "cerebras": "CEREBRAS_API_KEY", "gemini": "GEMINI_API_KEY",
            "openrouter": "OPENROUTER_API_KEY"}


def _keys_for(provider: str) -> list[str]:
    """All API keys configured for a provider, in priority order. Supports:
      • many keys in one var, comma/space separated:  CEREBRAS_API_KEY=key1,key2,key3
      • numbered extras:  CEREBRAS_API_KEY_2=…  CEREBRAS_API_KEY_3=…
    Deduped, blanks dropped. 'local' needs no real key."""
    if provider == "local":
        return ["ollama"]
    env = _ENV_KEY.get(provider)
    if not env:
        return []
    raw = re.split(r"[,\s]+", os.getenv(env, "").strip())
    i = 2
    while os.getenv(f"{env}_{i}"):
        raw.append(os.getenv(f"{env}_{i}", "").strip()); i += 1
    seen, out = set(), []
    for k in raw:
        k = k.strip()
        if k and k not in seen:
            seen.add(k); out.append(k)
    return out


def _models_for(provider: str) -> list:
    """Models to build for a provider. OpenRouter may list SEVERAL (comma-separated in
    OPENROUTER_MODEL) so its fallback tries each free Nemotron model in turn; every other
    provider builds its single configured model."""
    if provider == "openrouter":
        raw = os.getenv("OPENROUTER_MODEL", "nvidia/nemotron-3-super-120b-a12b:free")
        return [m.strip() for m in raw.split(",") if m.strip()] or [None]
    return [None]


def _build_one(provider: str, api_key: str, model: str | None = None):
    """A single OpenAI-compatible LLM for one provider, using the given API key (and, for
    OpenRouter, a specific model)."""
    if provider == "local":
        return openai.LLM(
            model=os.getenv("LOCAL_MODEL", "qwen2.5:3b"),
            base_url=os.getenv("LOCAL_BASE_URL", "http://localhost:11434/v1"),
            api_key="ollama", temperature=0.6, max_completion_tokens=MAX_REPLY_TOKENS,
        )
    if provider == "cerebras":
        return openai.LLM(
            model=os.getenv("CEREBRAS_MODEL", "gpt-oss-120b"),
            base_url="https://api.cerebras.ai/v1",
            api_key=api_key, temperature=0.6,
            reasoning_effort="low",   # gpt-oss reasons-to-empty without this
            max_completion_tokens=MAX_REPLY_TOKENS,
        )
    if provider == "gemini":
        return openai.LLM(
            model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
            api_key=api_key, temperature=0.6,
            max_completion_tokens=MAX_REPLY_TOKENS,
        )
    if provider == "openrouter":
        # OpenRouter aggregator — free-tier models (":free" suffix) have separate quota
        # pools from Groq/Cerebras. Free limits: ~20 req/min; ~50 req/day (1000/day once
        # $10 credit sits on the account).
        # reasoning MUST be disabled for Nemotron 3 on live calls — measured: reasoning
        # off = 1.0s with a clean tool call; reasoning on = 44s with mangled tool JSON.
        return openai.LLM(
            model=model or os.getenv("OPENROUTER_MODEL", "nvidia/nemotron-3-super-120b-a12b:free").split(",")[0].strip(),
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key, temperature=0.6,
            max_completion_tokens=MAX_REPLY_TOKENS,
            extra_body={"reasoning": {"enabled": False}},
        )
    return openai.LLM(  # groq
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        base_url="https://api.groq.com/openai/v1",
        api_key=api_key, temperature=0.6,
        max_completion_tokens=MAX_REPLY_TOKENS,
    )


def build_llm():
    """Build the LLM failover chain. Order: every key of LLM_PROVIDER, then every key of
    LLM_FALLBACK. A FallbackAdapter rotates to the NEXT instance on any error — so a dead /
    rate-limited / quota-exhausted API KEY is skipped automatically mid-call (not just a dead
    provider). Add more keys per provider in .env (comma-separated or NAME_2, NAME_3…)."""
    if LLM_PROVIDER not in {"groq", "gemini", "cerebras", "openrouter", "local"}:
        logger.warning(f"unknown LLM_PROVIDER '{LLM_PROVIDER}' — defaulting to groq")

    order = [LLM_PROVIDER]
    # LLM_FALLBACK may be comma-separated (e.g. "groq,openrouter") — add each in order, deduped.
    for fb in os.getenv("LLM_FALLBACK", "").strip().lower().split(","):
        fb = fb.strip()
        if fb and fb not in order:
            order.append(fb)

    instances, labels = [], []
    for prov in order:
        if prov not in {"groq", "gemini", "cerebras", "openrouter", "local"}:
            continue
        models = _models_for(prov)   # >1 for OpenRouter (tries each Nemotron model in turn)
        for idx, key in enumerate(_keys_for(prov), 1):
            for m in models:
                try:
                    instances.append(_build_one(prov, key, m))
                    tag = f"{prov}#{idx}" + (f"({m.split('/')[-1].replace(':free', '')})" if m else "")
                    labels.append(tag)
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"LLM {prov}#{idx} ({m or 'default'}) unavailable ({e}); skipping")

    if not instances:   # nothing configured → last-ditch groq attempt so we fail loudly, not silently
        return _build_one("groq", os.getenv("GROQ_API_KEY", ""))
    if len(instances) == 1:
        logger.info(f"LLM: {labels[0]} (no failover — add more keys to enable)")
        return instances[0]

    from livekit.agents.llm import FallbackAdapter
    logger.info(f"LLM failover chain ({len(instances)}): {' → '.join(labels)}")
    # max_retry_per_llm=0 + short attempt_timeout → fail over fast on a sustained 429/401.
    return FallbackAdapter(instances, max_retry_per_llm=0, attempt_timeout=4.0)


# The reply is cleaned ONCE, at the source, in Priya.llm_node (leaked tool JSON, markdown,
# stage directions, stacked questions) — so the chat HISTORY stores exactly what is spoken
# and every model, reasoning or instruct, streams to TTS sentence-by-sentence. Priya starts
# speaking on the first sentence instead of waiting for the whole reply.

# Cap how many past conversation items are sent to the LLM each turn. The system prompt is
# separate (always kept); this just bounds the GROWING history so prompt_tokens stays flat on
# long calls — lowers cost, latency, and how fast you hit provider rate limits. ~0 = unlimited.
MAX_HISTORY_ITEMS = int(os.getenv("MAX_HISTORY_ITEMS", "14"))


# ── The Priya agent ──────────────────────────────────────────────────────────
INSTRUCTIONS = """
# ROLE
You are {{agent_name}}, a warm, professional admissions counsellor making an OUTBOUND call for
{{university_name}} to a prospective student who enquired about admission for {{academic_year}}.
Be a genuine, enthusiastic advocate: make them feel welcome, understand what they want, give honest
expert advice, and motivate the next step (campus visit, virtual tour, or counselling).

# LANGUAGE
{{language_block}}

# MISSION (genuine, never pushy)
- Warm and confident, like a helpful senior — not a telemarketer.
- APPRECIATE them genuinely. When they share marks, a score, a rank, an exam cleared, or any
  achievement, react FIRST with specific, warm praise before your next question — e.g.
  "92%? That's excellent, well done!", "You cleared JEE? Fantastic, congratulations!",
  "Great score, you should be proud." Match the praise to how strong it is (a great score gets
  bright praise; a modest one gets encouragement like "That's a solid base, we can build on that")
  — always uplifting, never fake or over-the-top, and never mock a low score.
- Sell with FACTS matched to their interest: weave in ONE real strength at a time (from tools), never a feature dump.
- Scholarship is your biggest hook: once you know their exam + score, praise the score, then call check_scholarship and tell them the exact % they'd get ("With that score you'd get X% scholarship — wonderful!").
- REMEMBER what they already told you (see the "KNOWN ABOUT THIS CALLER" note). NEVER re-ask their program, name or scores. If they ask about fees, use their ALREADY-KNOWN program: call get_fees(that program), tell them the tuition, then ask "Is this fee comfortable for you, or shall I check your scholarship?" — never ask which program again.
- Handle hesitation by acknowledging it and answering with a real fact (fees, scholarships, placements, hostel, safety).
- Always drive to the next step with gentle urgency. Be 100% honest — never invent facts, figures or promises.

# VOICE & STYLE (phone call)
- Sound genuinely warm and friendly — like a caring senior who's happy to help, not a script-reader.
  Smile through your words, use the caller's name often, and react naturally ("Oh nice!", "Great choice!",
  "Don't worry, I'll help you with that"). Be human and encouraging, never flat or robotic.
- Say ONE short thing, then STOP. Exactly ONE question per turn. Output only your own spoken line — never imagine the caller's reply.
- Keep every reply under 25 words. NEVER write "..." or ellipses, and NEVER re-ask a question you have already asked — move to the next step instead.
- PLAIN spoken words only: no markdown, emojis, "Priya:" prefix, or parenthetical stage directions.
- Warmly acknowledge each answer ("Thank you!", "Got it", "Perfect") and confirm important ones back before moving on.
- For ANY fact (courses, fees, eligibility, exams, scholarships, placements, facilities, rankings) CALL THE TOOL and speak only what it returns; if unavailable, say a counsellor will follow up. Keep the call under ~5 minutes.
- If a tool returns several figures, say only the one they asked about, then offer the rest ("Want the hostel fees too?").

# OPENING
1. The short greeting ("Is this a good time?") has ALREADY been spoken — never re-greet. If no/busy: offer a callback at a convenient time, thank them, end.
2. If yes, FIRST ask their name warmly — "May I know your name, please?" — and save_detail(student_name). THEN ask the program question. Use their name naturally through the rest of the call.

# CONVERSATION FLOW (in order, natural; save_detail each answer)
1. Their name — FIRST, right after they agree to talk ("May I know your name, please?"). save_detail(student_name); address them by it naturally through the call.
2. Program of interest. If they're unsure or ask "what do you offer", FIRST call list_branches and
   warmly share the main B.Tech branches (CSE, ECE, EEE, Mechanical, Civil…) — a short, friendly list.
   When they pick a branch (e.g. CSE), THEN call list_programs("CSE") and share that branch's
   specialisations (core CSE, AI & ML, Data Science, and the SAP / Google Cloud / Microsoft tracks).
   Confirm their exact choice back and save_detail(program_of_interest) + specialization.
3. Entrance exams taken/appearing (name + status); praise any exam cleared or attempted; then ask if they'd take a {{university_name}} entrance exam.
4. Academics: Class 10 %, Class 12 %, graduation score + status if applicable. APPRECIATE each score warmly as they say it ("That's a great percentage!") before asking the next.
5. Current city.
6. Next step: campus visit / virtual tour / counselling (if counselling, ask mode: telephonic/video/in_person/webinar).
   Once they choose, ask their preferred day and time ("When would suit you — say, Saturday morning?"),
   confirm it back, and save_detail(visit_datetime) with what they said (e.g. "Saturday 11 AM").
7. Their questions — answer via tools; if they gave exam + score, proactively offer their scholarship.

# PACING
- ANSWER THE CALLER FIRST. If you just called a tool, SPEAK its result — never ignore their question to collect a detail.
- Ask the name EARLY — right after they agree to talk, BEFORE the program question; never re-ask. Collect other flow details naturally, one at a time — they're secondary to helping.
- When the caller asks the fee/details of a SPECIFIC specialisation (e.g. "the SAP one", "CSE with Google Cloud", "Data Science"), pass THAT EXACT specialisation to get_fees / lookup_program — never substitute a different one. If unsure which they mean, ask them to confirm before quoting.
- Say the opening once, then move forward. Set call_outcome ONLY at the very end.
- Call save_detail ONLY with a real value the caller gave — never blank or guessed. Never type a tool call as spoken text.

# CLOSING
Summarise the next step you arranged, thank them by name, end politely.

# DATA TO COLLECT (save_detail as captured)
student_name, program_of_interest, specialization, program_duration, entrance_exams_taken,
willing_university_exam, engagement_choice (campus_visit|virtual_tour|counselling),
counselling_mode (telephonic|video|in_person|webinar), visit_datetime (their booked day+time,
e.g. "Saturday 11 AM"), class_10_score, class_12_score,
graduation_score, graduation_status, current_city, questions_asked, follow_up_required,
call_outcome (interested|callback|not_interested)

# GUARDRAILS
- Never state a number, %, recruiter, package or ranking unless a tool returned it THIS turn — quote it exactly. You have NO placement % unless get_placements returned it.
- Don't promise admission/scholarships/waivers beyond tool output. Don't collect payment or ID details.
- If they opt out, respect it immediately and end. If distressed/hostile, stay calm and offer a human callback.

# FACTUAL QUESTIONS (use tools, never memory)
{{course_knowledge_base}}
""".strip() \
    .replace("{{agent_name}}", AGENT_NAME) \
    .replace("{{university_name}}", UNIVERSITY_NAME) \
    .replace("{{academic_year}}", ACADEMIC_YEAR) \
    .replace("{{default_language}}", DEFAULT_LANGUAGE) \
    .replace("{{language_block}}", LANGUAGE_BLOCK) \
    .replace("{{student_name}}", _student_ref) \
    .replace("{{course_knowledge_base}}", KNOWLEDGE_BASE)

# ── Nemotron-only style override ─────────────────────────────────────────────
# Nemotron ignores the softer style rules above — it writes paragraphs and dash/bullet lists
# that get read aloud awkwardly and run 20-30s. This block is blunt and repetitive on purpose;
# it's appended LAST (highest recency) only when Nemotron is the active model.
NEMOTRON_STYLE = """

# ⚠ HARD OUTPUT RULES — FOLLOW EXACTLY (you tend to over-explain; do NOT)
- Reply in ONE spoken sentence, MAXIMUM 25 words, then STOP. Never two sentences of content.
- ABSOLUTELY NO lists. No bullet points, no dashes ("-"), no numbered items, no "colon then a list",
  no line breaks. These are a PHONE call — a list cannot be read aloud.
- If you would list options, instead name only TWO or THREE in a natural sentence and offer more:
  e.g. "We have core CSE, Data Science, and an SAP-partnered track — shall I tell you about those?"
- NEVER say a filler like "Let me get the list/details for you" and then dump it. Just answer in one
  sentence, or call the tool and speak only the ONE thing they asked about.
- Do NOT begin every reply with "Great!" / "Excellent!" / "Great question!" — vary it, and usually
  skip it. Get to the point warmly.
- Exactly ONE question per turn, then wait. Never write or imagine the caller's reply.
"""
if IS_NEMOTRON:
    INSTRUCTIONS = INSTRUCTIONS + NEMOTRON_STYLE


# Fixed opening line — spoken in full, first, before anything else. A fixed string
# (not an LLM-generated reply) so it never comes out in fragments or gets re-greeted;
# it's added to the chat history, so the LLM knows it has already greeted and moves on.
# Kept SHORT (~4s of audio): phone callers hang up on long monologue openers.
GREETING = (
    f"Hello! This is {AGENT_NAME} from {UNIVERSITY_NAME}, "
    "calling about your admission enquiry. Is this a good time?"
)


# Safety net: some models (esp. smaller ones) LEAK tool calls as spoken text, e.g.
#   <function=save_detail>{"field": "student_name", "value": "Karthik"}</function>
# If that reaches TTS the caller HEARS it. Strip any such tool syntax + stray JSON arg
# blobs before synthesis, regardless of which model is used.
def _strip_tool_syntax(s: str) -> str:
    s = re.sub(r"<function\s*=[^>]*>\s*\{.*?\}\s*</?function>", " ", s, flags=re.DOTALL | re.IGNORECASE)
    s = re.sub(r"</?function[^>]*>", " ", s, flags=re.IGNORECASE)          # bare/opening/closing tags
    # Any brace block is tool-arg JSON leaking through — braces never appear in real speech.
    # Iterate: a single pass leaves the OUTER braces of nested JSON ({"args": {...}}) behind.
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r"\{[^{}]*\}", " ", s)
    # gpt-oss sometimes echoes the tool result ("Saved program_of_interest.") or fakes a
    # "Label: value" data dump. Drop a trailing "Saved …" echo; it's never something to speak.
    s = re.sub(r"\bSaved(?:\s+[A-Za-z_]+)?\.", " ", s)
    # gpt-oss pads replies with runs of dots ("......") to fill tokens — collapse them so
    # they're never spoken and don't split into stray "pauses" in the transcript.
    s = re.sub(r"\s*\.{2,}\s*", ". ", s)
    s = re.sub(r"\s{2,}", " ", s).strip()
    return s


class Priya(Agent):
    def __init__(self, student_name: str = "", reporter: Reporter | None = None,
                 job_ctx: JobContext | None = None) -> None:
        # Per-call personalisation injected from the CRM (via dispatch metadata): if we
        # already know the prospect's name, tell Priya so she greets them by it and skips
        # asking. Everything else (prompt, voice, tools) is unchanged.
        instructions = INSTRUCTIONS
        if student_name:
            instructions += (
                f"\n\n# THIS CALL\nThe student's name is {student_name}. Greet and address them "
                "by it naturally during the call; you do NOT need to ask for their name."
            )
        super().__init__(
            instructions=instructions,
            stt=sarvam.STT(
                model="saaras:v3",
                language=STT_LANGUAGE,   # "en-IN" (English-only) or "unknown" (auto-detect)
                mode="transcribe",       # keep source language (we reply in it)
                flush_signal=True,       # emit start/end-of-speech for turn-taking
            ),
            llm=build_llm(),
            tts=sarvam.TTS(
                model="bulbul:v3",
                target_language_code=TTS_START_LANG,
                speaker=SARVAM_SPEAKER,
                pace=TTS_PACE,
                # Telephony-native audio: G.711 mu-law at 8 kHz — the EXACT format the phone
                # network (Twilio/PSTN) uses. Unlike mp3, mu-law is sample-by-sample with NO
                # frame boundaries, so the stream can't gap/garble at frame edges (that was the
                # "breaking"), and it needs no resampling down to the phone. This is the fix.
                speech_sample_rate=8000,
                output_audio_codec="mulaw",
                output_audio_bitrate="64k",  # ignored for mu-law, but the plugin always sends a value
                enable_cached_responses=True,  # repeated phrases (greeting etc.) come back instantly
            ),
        )
        # In-memory collected fields for this call (port the full schema as needed).
        self.collected: dict[str, str] = {}
        # Current voice language (updated by the multilingual handler); picks the filler language.
        self._lang: str = TTS_START_LANG
        # Pushes collected details to the dashboard as they're captured (no-op if standalone).
        self._reporter = reporter
        # JobContext, so Priya can hang up the SIP call herself once the conversation
        # concludes (delete_room disconnects the caller). None in some test paths.
        self._job_ctx = job_ctx
        self._hangup_started = False

    async def _hang_up_after_closing(self):
        """End the call automatically once Priya has finished her closing line.

        Triggered when the LLM saves call_outcome (the conversation is over). We do NOT
        hang up immediately — the goodbye still has to be generated and spoken. So we wait
        for Priya to actually be speaking, then for BOTH sides to fall silent for a short
        grace period (covering a trailing "thank you" / "you're welcome"), then delete the
        room, which disconnects the caller and ends the SIP call."""
        if self._hangup_started:
            return
        self._hangup_started = True
        try:
            session = self.session
            # 1) Wait (up to 8s) for the closing line to START playing, so we never hang up
            #    in the gap before the goodbye audio begins.
            for _ in range(80):
                if session.agent_state == "speaking":
                    break
                await asyncio.sleep(0.1)
            # 2) Wait for the call to go fully quiet — neither Priya speaking/thinking nor the
            #    caller talking — for 1.6s straight (capped at ~30s so we always end).
            quiet = 0.0
            for _ in range(150):
                await asyncio.sleep(0.2)
                busy = (session.agent_state in ("speaking", "thinking")
                        or session.current_speech is not None
                        or session.user_state == "speaking")
                quiet = 0.0 if busy else quiet + 0.2
                if quiet >= 1.6:
                    break
        except Exception as e:  # noqa: BLE001
            logger.warning(f"hang-up wait error: {e}")
        # Small pause so the last audio frames flush to the phone before teardown.
        await asyncio.sleep(0.4)
        logger.info("conversation concluded — hanging up the call")
        try:
            if self._job_ctx is not None:
                await self._job_ctx.delete_room()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"delete_room (hang-up) failed: {e}")

    async def _prewarm_llm(self):
        # Fire a tiny throwaway completion in the BACKGROUND while the greeting plays, so the
        # FIRST real turn's LLM is warm (~0.5s ttft) instead of cold (~1.6s). Warms the TLS
        # connection + provider-side model routing. Best-effort: any failure is ignored.
        try:
            ctx = ChatContext.empty()
            ctx.add_message(role="user", content="hi")
            stream = self.llm.chat(chat_ctx=ctx)
            try:
                async for _ in stream:
                    break                      # first chunk is enough to warm the path
            finally:
                await stream.aclose()
            logger.info("llm prewarmed")
        except Exception as e:
            logger.debug(f"llm prewarm skipped: {e}")

    async def on_enter(self):
        # Warm the Sarvam translate connection in the BACKGROUND while the greeting plays,
        # so the first real translate of the call is warm (~0.3s) not cold (~0.7s). The
        # ~12s greeting gives it plenty of time. Skipped automatically if translate-out is off.
        if TRANSLATE_OUT:
            warm_lang = next((l for l in TTS_ALLOWED if not l.lower().startswith("en")), "te-IN")
            asyncio.create_task(translate_prewarm(warm_lang, gender=TRANSLATE_GENDER, mode=TRANSLATE_MODE))
        # Same idea for the LLM — warm it during the greeting so turn 1 isn't cold.
        asyncio.create_task(self._prewarm_llm())
        # Speak the greeting first, before anything else. It's a fixed string added to the
        # chat history, so the LLM knows it already greeted and never re-greets. It IS
        # interruptible: if the caller talks over it ("hello? who is this?"), Priya stops
        # and responds — a false trigger (echo/noise) auto-resumes the greeting instead
        # of losing it (resume_false_interruption above).
        await self.session.say(GREETING)

    async def on_user_turn_completed(self, turn_ctx, new_message):
        # Bound the history sent to the LLM (system prompt is separate and kept). Keeps
        # prompt_tokens roughly flat across a long call instead of growing every turn.
        if MAX_HISTORY_ITEMS > 0:
            try:
                turn_ctx.truncate(max_items=MAX_HISTORY_ITEMS)
            except Exception as e:  # noqa: BLE001
                logger.debug(f"history truncate skipped: {e}")

    # Short, live summary of everything collected so far — injected each turn so Priya
    # NEVER forgets the caller's program/name/scores after history truncation (and so never
    # re-asks something they already told her).
    _DETAIL_LABELS = {
        "student_name": "Name", "program_of_interest": "Program", "specialization": "Specialization",
        "entrance_exams_taken": "Exam", "class_10_score": "Class 10 %", "class_12_score": "Class 12 %",
        "graduation_score": "Graduation", "current_city": "City", "engagement_choice": "Next step",
        "counselling_mode": "Counselling mode", "visit_datetime": "Booked time",
    }

    def _known_details(self) -> str:
        parts = [f"{lbl}: {self.collected[k]}" for k, lbl in self._DETAIL_LABELS.items() if self.collected.get(k)]
        return "; ".join(parts)

    # ── LLM output filter ──────────────────────────────────────────────────────
    # Clean the reply AT THE SOURCE, not just before TTS. gpt-oss tends to dump the whole
    # question flow (5 stacked questions) in one 160-token wall and sometimes TYPES a tool
    # call / its JSON result as text. Cleaning only in tts_node left all of that in the chat
    # HISTORY, so every later turn saw leaked JSON + questions "already asked" and got worse.
    # Filtering here means history == exactly what was spoken, and we can CANCEL the
    # generation the moment the first question is complete — less latency, fewer tokens.
    async def llm_node(self, chat_ctx, tools, model_settings):
        # Inject a live "known so far" note so Priya always has the caller's collected details
        # (program, name, scores, booked slot) even after history truncation — she uses them
        # directly instead of re-asking. Copy the ctx so this note never accumulates in history.
        known = self._known_details()
        if known:
            try:
                chat_ctx = chat_ctx.copy()
                chat_ctx.add_message(role="system",
                    content=f"KNOWN ABOUT THIS CALLER — do NOT re-ask these; use them directly: {known}")
            except Exception as e:  # noqa: BLE001
                logger.debug(f"known-details inject skipped: {e}")
        stream = Agent.default.llm_node(self, chat_ctx, tools, model_settings)
        buf = ""            # text not yet split into complete sentences
        spoken = 0          # chars emitted this turn (MAX_SPOKEN_CHARS cap)
        saw_tool = False    # a real tool call arrived → drain the stream, don't cancel it
        done = False        # first question / length cap reached → drop any further text

        def _clean(sentence: str) -> str:
            s = _strip_tool_syntax(sentence)
            s = re.sub(
                r"\([^)]*\b(?:waiting|response|pause|silence|continue|listening|no reply|note)\b[^)]*\)",
                "", s, flags=re.IGNORECASE,
            )
            s = s.replace("*", "").replace("#", "").replace("`", "")
            # Braces never occur in real speech. _strip_tool_syntax removed complete JSON
            # blocks; an UNTERMINATED one (stream cut mid-JSON) still starts with "{" — drop
            # from there to the end, keeping the legit speech before it.
            s = re.sub(r"\{.*", " ", s, flags=re.DOTALL)
            s = s.replace("}", " ")
            s = re.sub(r"\s{2,}", " ", s).strip()
            # Nothing word-like left (stray punctuation only) → nothing to say.
            return s if re.search(r"\w", s) else ""

        try:
            async for chunk in stream:
                if isinstance(chunk, str):
                    delta = chunk
                elif isinstance(chunk, ChatChunk) and chunk.delta is not None:
                    if chunk.delta.tool_calls:
                        saw_tool = True
                        # Forward the tool calls but NOT the content — text is re-emitted
                        # by us below, after cleaning.
                        yield chunk.model_copy(
                            update={"delta": chunk.delta.model_copy(update={"content": None})})
                    delta = chunk.delta.content
                else:
                    yield chunk   # flush sentinels etc. pass through untouched
                    continue

                if not delta or done:
                    continue
                # Accumulate RAW (no buffer-level strip — stripping trails would glue words
                # across chunk boundaries); _clean handles each complete sentence instead.
                buf += delta
                while not done:
                    # A "." ends a sentence only when followed by whitespace (a bare "." would
                    # split "B.Tech" / "₹2.75" mid-token). Strong enders (? ! ।) split even with
                    # NO space after — gpt-oss glues its stacked questions together ("…?Got it.").
                    # Reply-final text with no trailing space waits in buf for the tail flush.
                    m = re.search(r"[.!?।。！？]+[\"')\]]*\s|[!?！？।。]+[\"')\]]*", buf)
                    if not m:
                        break
                    sentence, buf = _clean(buf[: m.end()]), buf[m.end():]
                    if not sentence:
                        continue
                    yield sentence + " "
                    spoken += len(sentence)
                    # One question per turn / spoken-length cap → the reply is complete.
                    if "?" in sentence or spoken >= MAX_SPOKEN_CHARS:
                        done = True
                if done and not saw_tool:
                    break   # cancel the request — don't generate questions 2..N at all
            if not done:
                tail = _clean(buf)
                if tail:
                    yield tail
        finally:
            await stream.aclose()

    async def tts_node(self, text, model_settings):
        # Open the Sarvam TTS websocket NOW, in the background, while the LLM is still
        # streaming and mayura is translating the first sentence. Without this, the
        # connect+config handshake (~0.1-0.25s) only started AFTER the translated text
        # arrived — serial cost on every reply whose pooled connection had gone idle.
        # prewarm() is a no-op when a live pooled connection already exists.
        try:
            self.tts.prewarm()
        except Exception as e:  # noqa: BLE001
            logger.debug(f"tts prewarm skipped: {e}")

        # Translate-out is active only when enabled AND the caller's language is non-English.
        needs_translation = TRANSLATE_OUT and bool(self._lang) and not self._lang.lower().startswith("en")
        # Hard spoken-length cap per turn so a verbose reply can't become a 20-30s monologue
        # that stutters over the network. Indic TTS (translate-out) runs ~2x longer per char,
        # so cap it tighter there.
        spoken_cap = int(MAX_SPOKEN_CHARS * 0.55) if needs_translation else MAX_SPOKEN_CHARS

        # llm_node already delivers clean one-question text — STREAM it sentence-by-sentence
        # so TTS starts on the first sentence (big latency win) instead of waiting for the
        # whole reply. With translate-out on, a producer reads the LLM stream and fires each
        # sentence's translation CONCURRENTLY, while the consumer yields them in order — so
        # sentence N+1 translates while sentence N is being spoken (only the first sentence's
        # translate is on the critical path).
        def _spoken(sentence: str):
            # Returns an awaitable resolving to the text to speak (translated or passthrough).
            if needs_translation:
                return asyncio.create_task(
                    translate_out(sentence, self._lang, gender=TRANSLATE_GENDER, mode=TRANSLATE_MODE))
            return asyncio.create_task(asyncio.sleep(0, result=sentence))

        async def streamed():
            queue: asyncio.Queue = asyncio.Queue()

            async def produce():
                buf = ""
                stopped = False
                spoken = 0          # chars emitted this turn (spoken_cap enforcement)
                try:
                    async for chunk in text:
                        if not chunk or stopped:
                            continue
                        buf += chunk.replace("*", "").replace("#", "").replace("`", "")
                        buf = _strip_tool_syntax(buf)   # drop leaked tool calls before splitting
                        while True:
                            # punctuation + whitespace only — never split "B.Tech" / "₹2.75"
                            m = re.search(r"[.!?।。！？]+[\"')\]]*\s", buf)
                            if not m:
                                break
                            sentence = re.sub(r"\s{2,}", " ", _strip_tool_syntax(buf[: m.end()])).strip()
                            buf = buf[m.end():]
                            if not sentence:
                                continue
                            # Length cap: if this sentence would overflow the budget, truncate it
                            # at a word boundary, speak that, and stop — so even a single long
                            # info-dump sentence can't run 20-30s and break up over the network.
                            remaining = spoken_cap - spoken
                            if len(sentence) > remaining:
                                clipped = sentence[:remaining].rsplit(" ", 1)[0].rstrip(",;:—- ")
                                clipped = clipped or sentence[:remaining]
                                await queue.put(_spoken(clipped + "."))
                                stopped = True
                                buf = ""
                                break
                            await queue.put(_spoken(sentence))   # fire translate now (concurrent)
                            spoken += len(sentence)
                            # Stop after the first question (one question per turn).
                            if "?" in sentence:
                                stopped = True
                                buf = ""
                                break
                    if not stopped:
                        tail = re.sub(r"\s{2,}", " ", _strip_tool_syntax(buf)).strip()
                        if tail and spoken < spoken_cap:
                            await queue.put(_spoken(tail))
                finally:
                    await queue.put(None)   # sentinel: no more sentences

            producer = asyncio.create_task(produce())
            try:
                while True:
                    task = await queue.get()
                    if task is None:
                        break
                    out = await task
                    if out:
                        yield out
            finally:
                await producer

        async for frame in Agent.default.tts_node(self, streamed(), model_settings):
            yield frame

    # ── Tools (port more from the Node agentTools.js as you need them) ────────
    @function_tool()
    async def save_detail(self, context: RunContext, field: str, value: str):
        """Save one collected detail, only with a real value from the caller.
        `field` = one of the DATA TO COLLECT keys in your instructions (e.g. student_name,
        program_of_interest, visit_datetime, call_outcome)."""
        v = str(value or "").strip()
        if not v or v.lower() in {"not provided", "not given", "unknown", "n/a", "na",
                                   "none", "null", "tbd", "-"}:
            return "Nothing concrete to save yet — ask the caller for the actual value first."
        self.collected[field] = v
        logger.info(f"save_detail: {field} = {v}")
        if self._reporter:
            self._reporter.emit(type="detail", field=field, value=v)
        # call_outcome is saved only at the very end (per the prompt) → the conversation is
        # concluding. Kick off auto hang-up so Priya ends the call herself after her goodbye,
        # instead of leaving dead air until the caller hangs up.
        if field == "call_outcome":
            asyncio.create_task(self._hang_up_after_closing())
        return f"Saved {field}."

    # ── Knowledge lookups (exact, from university_data.py — NOT invented) ──────
    @function_tool()
    async def lookup_program(self, context: RunContext, program: str):
        """Program details (degree, eligibility, accepted exams, fee, highlights). `program` = what the caller said."""
        course = udata.find_course(program)
        if not course:
            return (f"No exact match for '{program}'. Ask the caller to name the specific course, "
                    "or offer to list programs in a school (use list_programs).")
        return udata.format_course(course)

    @function_tool()
    async def get_fees(self, context: RunContext, program: str):
        """Get the annual tuition fee for a program, plus the one-time admission fee, ASAT fee and
        hostel options. Only quote what this returns — never estimate fees."""
        course = udata.find_course(program)
        fee_line = (f"{course['name']}: tuition {course['fee']}."
                    if course and course.get("fee")
                    else f"I don't have a specific fee for '{program}' — a counsellor will confirm.")
        cf = udata.COMMON_FEES
        return (f"{fee_line} One-time admission fee {cf['admission_fee']}. ASAT exam fee {cf['asat_fee']}. "
                f"Hostel: Non-AC {cf['hostel_non_ac']}; AC {cf['hostel_ac']}.")

    @function_tool()
    async def check_scholarship(self, context: RunContext, exam: str, score: str, program: str):
        """Merit scholarship %. `exam`=ASAT/JEE/EAPCET/BIE/CBSE/CAT/NMAT/NEET, `score`=percentile/%/marks/rank, `program`=course."""
        return udata.compute_scholarship(exam, score, program)

    @function_tool()
    async def list_programs(self, context: RunContext, category: str = ""):
        """List the SPECIALISATION tracks under a branch/degree (synonym-aware). Use AFTER the
        caller picks a branch — e.g. category="CSE" returns core CSE + AI&ML + Data Science +
        the SAP/Google/Microsoft associated tracks. Also accepts "B.Tech", "MBA", "Pharmacy"."""
        names = udata.list_programs(category)
        if not names:
            return f"No programs match '{category}'. Schools: Engineering, Business, Pharmacy, Sciences."
        return "Programs" + (f" ({category})" if category else "") + ": " + "; ".join(names)

    @function_tool()
    async def list_branches(self, context: RunContext):
        """The high-level B.Tech BRANCH list (CSE, ECE, EEE, Mechanical, Civil, etc.). Use FIRST
        when a caller asks "what programs / courses do you offer" — read these branches, then use
        list_programs(branch) to go deeper once they pick one. Also mention MBA, Pharmacy & Sciences exist."""
        return "Our main B.Tech branches: " + "; ".join(udata.list_branches()) + \
               ". We also offer MBA, Pharmacy and Science programs."

    @function_tool()
    async def get_placements(self, context: RunContext, year: str = "2026"):
        """Get placement statistics and top recruiters. `year` = "2026" or "2025"."""
        p = udata.PLACEMENTS
        stats = p.get(str(year).strip(), p["2026"])
        return f"{stats} Top recruiters: {p['recruiters']} Internships: {p['internships']}"

    @function_tool()
    async def get_university_info(self, context: RunContext):
        """Get university facts: rankings (NAAC, NIRF, QS), accreditation, location, campus,
        international collaborations and contact details."""
        u = udata.UNIVERSITY
        return (f"{u['name']}, {u['location']}. Established {u['established']}. {u['campus']}. "
                f"Accreditation: {u['naac']}, {u['nba']}, {u['nirf']}, {u['qs']}. {u['the_impact']}. "
                f"{u['international']}. Website {u['website']}, contacts {u['contacts']}.")

    @function_tool()
    async def get_facilities(self, context: RunContext, topic: str = ""):
        """Get campus facilities. `topic` = hostel / medical / sports / safety / labs (blank = all)."""
        f = udata.FACILITIES
        t = topic.lower().strip()
        if t in f:
            return f"{t.capitalize()}: {f[t]}"
        return " ".join(f"{k.capitalize()}: {v}" for k, v in f.items())


async def entrypoint(ctx: JobContext):
    logger.info(f"Priya joining room: {ctx.room.name}")
    logger.info(f"translate-out: {'ON' if TRANSLATE_OUT else 'OFF'} | mode={TRANSLATE_MODE} | "
                f"multilang={MULTILANG} | allowed={sorted(TTS_ALLOWED)}")

    # ── Per-call context from the dashboard ────────────────────────────────────
    # The Node backend dispatches this agent with JSON metadata: the session id to
    # report back to, the backend report URL, the prospect's name, and voice prefs.
    # (Empty when launched via `python agent.py console` — then we just run standalone.)
    meta: dict = {}
    try:
        if ctx.job and ctx.job.metadata:
            meta = json.loads(ctx.job.metadata)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"could not parse job metadata: {e}")

    session_id   = meta.get("session_id")
    report_url   = meta.get("report_url") or os.getenv("BACKEND_REPORT_URL", "")
    # Ignore CRM placeholder names ("New Contact", "Unknown", "Prospect"…) — otherwise Priya
    # greets the caller as "New Contact". Treat those as no-name so she asks for the real one.
    _raw_name    = (meta.get("name") or STUDENT_NAME or "").strip()
    _PLACEHOLDERS = {"", "new contact", "unknown", "prospect", "student", "lead", "n/a", "na",
                     "none", "null", "test", "caller"}
    student_name = "" if _raw_name.lower() in _PLACEHOLDERS else _raw_name

    reporter = Reporter(report_url, session_id)
    reporter.start()

    agent = Priya(student_name=student_name, reporter=reporter, job_ctx=ctx)

    # Sarvam handles VAD + turn detection internally — no separate vad / silero needed.
    session = AgentSession(
        # One retry, not three. Each LLM attempt already tries BOTH providers (FallbackAdapter)
        # plus fires their background recovery probes — every probe/attempt sends the FULL
        # ~2.7k-token prompt. When both providers are rate-limited (Cerebras RPM + Groq TPM),
        # 4 attempts stack ~8-16 full-prompt requests per turn into the SAME rate-limit
        # window, burning the very quota the retry is waiting for. Fail fast instead; the
        # error handler below keeps the caller engaged.
        conn_options=SessionConnectOptions(
            llm_conn_options=APIConnectOptions(max_retry=1, retry_interval=2.0, timeout=10.0),
        ),
        turn_handling={
            "turn_detection": "stt",   # Sarvam STT emits start/end-of-speech (Telugu-aware — keep)
            "endpointing": {"min_delay": float(os.getenv("EOU_MIN_DELAY", "0.2"))},  # end-of-turn wait (0.2 = latency trim; 0.15 = aggressive, may clip slow talkers)
            # Preemptive generation ON (LLM only): drafting starts while the endpointing
            # delay is still running, hiding most of the LLM TTFT behind the ~1s Sarvam
            # transcript finalization we're paying anyway (~0.5-1s off every turn).
            # preemptive_tts stays FALSE — audio synthesis only starts once the turn is
            # confirmed, which is what prevented the old "overlapping/cut audio" problem
            # that led to this being disabled before llm_node did the reply cleaning.
            # Set PREEMPTIVE_GENERATION=false to switch back if artifacts return.
            "preemptive_generation": {
                "enabled": os.getenv("PREEMPTIVE_GENERATION", "true").lower() != "false",
                "preemptive_tts": False,
            },
            # Barge-in ON: the caller starts talking → Priya STOPS mid-sentence, listens,
            # replies, and the flow continues. It used to be fully off (phone echo of Priya's
            # own voice interrupted her) — but off means the session DROPS every user turn
            # that arrives while she speaks ("skipping reply … cannot be interrupted").
            #   • min_words MUST be 0 here: Sarvam STT sends only FINAL transcripts (no
            #     interims), so any word-count gate blocks the mid-speech stop entirely and
            #     she'd talk over the caller until their sentence ends.
            #   • Echo/noise protection comes from min_duration (≥0.8s of sustained speech)
            #     plus false-interruption RESUME: if she pauses and no real speech follows
            #     (echo dies the instant she goes quiet), she picks her sentence back up
            #     after 2s instead of losing it.
            "interruption": {
                "enabled": True,
                "min_duration": 0.8,
                "min_words": 0,
                "resume_false_interruption": True,
                "false_interruption_timeout": 2.0,
                # If anything uninterruptible is ever playing, still keep (don't discard)
                # what the caller says during it — transcribe and answer right after.
                "discard_audio_if_uninterruptible": False,
            },
        },
    )

    # ── Multilingual voice (only when MULTILANG=true) ──────────────────────────
    # STT auto-detects the language and the LLM replies in it; this switches the
    # Sarvam *voice* to match each turn, so a Hindi reply isn't spoken with a Telugu
    # voice. Only within TTS_ALLOWED, and only when the language actually changes.
    # In English-only mode this is skipped — the voice stays en-IN.
    if MULTILANG:
        last_lang = {"code": TTS_START_LANG}
        # True once the caller has explicitly asked for a NON-English language — then we don't
        # auto-revert to English just because their next utterance happens to be in English.
        pref_nonenglish = {"on": False}

        def _switch_voice(code: str, reason: str):
            last_lang["code"] = code
            agent._lang = code
            try:
                agent.tts.update_options(target_language_code=code)
                logger.info(f"voice language → {code} ({reason})")
            except Exception as e:  # noqa: BLE001
                logger.warning(f"TTS language switch failed: {e}")
            # Warm Sarvam translate for the NEW language right away (fire-and-forget), so the
            # first reply after a switch translates warm (~0.3s) instead of cold (~1-2s).
            if TRANSLATE_OUT and not code.lower().startswith("en"):
                asyncio.create_task(
                    translate_prewarm(code, gender=TRANSLATE_GENDER, mode=TRANSLATE_MODE))

        def _requested_language(t: str):
            """If the caller is asking to switch language (e.g. 'speak in Telugu'), return that
            language code; else None. Matches a language name + a request hint, or a short command."""
            low = t.lower()
            for code, names in LANG_NAMES.items():
                if code not in TTS_ALLOWED:
                    continue
                if any(n in low for n in names):
                    if len(t) <= 35 or any(h in low for h in LANG_REQUEST_HINTS):
                        return code
            return None

        @session.on("user_input_transcribed")
        def _follow_language(ev):
            lang = getattr(ev, "language", None)
            text = (getattr(ev, "transcript", "") or "").strip()
            if not getattr(ev, "is_final", True) or not text:
                return

            # 1) EXPLICIT request — "speak in Telugu", "తెలుగులో మాట్లాడండి", "अंग्रेजी में बात करो".
            #    Honour it directly (even if said in another language / a short phrase).
            req = _requested_language(text)
            if req and req != last_lang["code"]:
                pref_nonenglish["on"] = not req.lower().startswith("en")
                _switch_voice(req, "requested")
                return

            # 2) Otherwise follow the language the caller is actually SPEAKING (≥12-char real
            #    sentence; the floor blocks short fragments STT mis-tags).
            if not lang or lang not in TTS_ALLOWED or lang == last_lang["code"] or len(text) < 12:
                return
            # After an explicit non-English request, don't snap back to English on an English
            # utterance — keep replying in the requested language until they say otherwise.
            if pref_nonenglish["on"] and lang.lower().startswith("en"):
                return
            _switch_voice(lang, "detected")

    # ── Dead-air guard ─────────────────────────────────────────────────────────
    # When a turn's LLM generation fails outright (both providers rate-limited at once),
    # Priya previously said NOTHING — the caller heard 15s+ of silence and hung up. Speak a
    # short hold line instead and invite them to repeat (their failed turn is lost, so
    # repeating is what actually recovers the conversation). Throttled so a burst of
    # failures doesn't stack apologies. Goes through tts_node → localised to their language.
    _last_hold = {"t": 0.0}

    @session.on("error")
    def _on_session_error(ev):
        if getattr(ev.error, "type", "") != "llm_error":
            return
        now = time.time()
        if now - _last_hold["t"] < 15.0:
            return
        _last_hold["t"] = now
        logger.warning("LLM turn failed (likely rate limits on all providers) — speaking hold line")
        try:
            session.say("Sorry, give me just a second. Could you repeat that, please?",
                        add_to_chat_ctx=False)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"hold line failed: {e}")

    # ── Live transcript → dashboard ────────────────────────────────────────────
    # Every finalised conversation item (Priya's lines AND the caller's) is mirrored
    # to the Node backend so the dashboard's TranscriptViewer updates in real time.
    # The greeting is added to chat history, so it's reported too; the per-turn fillers
    # use add_to_chat_ctx=False, so they're correctly skipped.
    @session.on("conversation_item_added")
    def _on_item(ev):
        item = ev.item
        if not isinstance(item, ChatMessage) or item.role not in ("user", "assistant"):
            return
        text = (item.text_content or "").strip()
        if text:
            reporter.emit(type="transcript", role=item.role, text=text,
                          detected_language=agent._lang)

    # ── Per-turn latency → latency_log.csv (chart with plot_latency.py) ─────────
    latency = LatencyTracker(session_id=session_id or ctx.room.name)

    @session.on("metrics_collected")
    def _on_metrics(ev):
        try:
            metrics.log_metrics(ev.metrics)   # human-readable line in the worker log
        except Exception:  # noqa: BLE001
            pass
        latency.collect(ev.metrics)

    # ── Call status → dashboard ────────────────────────────────────────────────
    start_ts = time.time()

    async def _on_shutdown():
        # The call is ending (caller hung up, room closed, or worker shutdown). Send a
        # final status + duration and flush the report queue before the process exits.
        duration = int(time.time() - start_ts)
        reporter.emit(type="status", status="completed", duration=duration,
                      detected_language=agent._lang)
        await reporter.aclose()
        await translate_aclose()

    ctx.add_shutdown_callback(_on_shutdown)

    await session.start(agent=agent, room=ctx.room)
    # Mark the call live once Priya is in and starting to speak.
    reporter.emit(type="status", status="in-progress", detected_language=agent._lang)


if __name__ == "__main__":
    # agent_name lets the SIP dispatch rule target this agent by name ("priya").
    # `python agent.py console` still works for local mic testing regardless.
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="priya"))
