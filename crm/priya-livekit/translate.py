"""
Sarvam translate-OUT: localise Priya's English reply into the caller's language
just before TTS, for more natural Indic phrasing than the LLM produces directly.

POST https://api.sarvam.ai/translate  (mayura:v1).  Never raises — on any error
or timeout it returns the original English text so the call keeps flowing (the
caller simply hears English for that line instead of a hang/crash).
"""
import os
import logging
from collections import OrderedDict

import aiohttp

logger = logging.getLogger("priya.translate")

_URL = "https://api.sarvam.ai/translate"
_session: aiohttp.ClientSession | None = None

# LRU phrase cache: repeated short lines ("Thank you.", "Got it.", confirmations) come
# back instantly (0 ms) instead of a fresh round-trip. Keyed by (text, lang, mode).
_CACHE: "OrderedDict[tuple, str]" = OrderedDict()
_CACHE_MAX = 512
_CACHE_MAX_LEN = 120   # only cache short-ish lines (they're the ones that repeat)


def _key() -> str:
    return os.getenv("SARVAM_API_KEY", "")


async def _get_session() -> aiohttp.ClientSession:
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession()
    return _session


async def _reset_session() -> None:
    """Drop the pooled session so the next call opens a fresh connection. Used after a
    failure that's usually a stale keep-alive socket gone cold during an idle gap."""
    global _session
    try:
        if _session and not _session.closed:
            await _session.close()
    except Exception:  # noqa: BLE001
        pass
    _session = None


async def _call(text: str, src: str, target_lang: str, gender: str, mode: str,
                output_script: str | None, timeout: float) -> str:
    body = {
        "input": text,
        "source_language_code": src,
        "target_language_code": target_lang,
        "speaker_gender": gender,
        "mode": mode,
        "numerals_format": os.getenv("TRANSLATE_NUMERALS", "international"),
        "model": "mayura:v1",
        "enable_preprocessing": False,
    }
    # output_script only matters for → native (TTS). 'spoken-form-in-native' transliterates the
    # kept-English words + numbers into native script (e.g. "annual fee" → "యాన్యువల్ ఫీ") so bulbul
    # reads the whole thing as fluent code-mix. Omitted for → English (Latin needs no script hint).
    if output_script:
        body["output_script"] = output_script
    sess = await _get_session()
    async with sess.post(
        _URL, json=body,
        headers={"api-subscription-key": _key(), "Content-Type": "application/json"},
        timeout=aiohttp.ClientTimeout(total=timeout),
    ) as r:
        if r.status != 200:
            logger.warning(f"translate {r.status} → returning original")
            return text
        data = await r.json()
        return (data.get("translated_text") or text)


async def translate_out(text: str, target_lang: str, gender: str = "Female",
                        mode: str = "modern-colloquial", timeout: float = 8.0) -> str:
    """English `text` → `target_lang` (e.g. 'te-IN'). Returns original on no-op/failure.
    Skips when target is English or empty, or when no API key is configured.
    Caches short repeated phrases for instant reuse."""
    text = (text or "").strip()
    if not text or not target_lang or target_lang.lower().startswith("en") or not _key():
        return text

    key = (text, target_lang, mode)
    cached = _CACHE.get(key)
    if cached is not None:
        _CACHE.move_to_end(key)          # mark recently used
        return cached

    # Two attempts: a turn after the idle greeting often hits a stale keep-alive socket that
    # only errors at the timeout. On the first failure we drop the connection and retry fresh,
    # which usually succeeds in <1s — far better than falling back to (wrong-voice) English.
    out = None
    per_attempt = max(2.0, timeout / 2)
    script = os.getenv("TRANSLATE_OUTPUT_SCRIPT", "spoken-form-in-native")
    # 'auto' source lets Sarvam detect the LLM's output language and RE-STYLE it into natural
    # code-mix — so it works whether the LLM replied in English OR already in Hindi/Telugu/etc.
    # (with en-IN, a Hindi reply came back formal & un-mixed). No translate-in needed.
    src = os.getenv("TRANSLATE_SOURCE", "auto")
    for attempt in (1, 2):
        try:
            out = await _call(text, src, target_lang, gender, mode, script, per_attempt)
            break
        except Exception as e:  # noqa: BLE001
            # str(TimeoutError) is empty, so include the type — otherwise this logs "()".
            if attempt == 1:
                logger.info(f"translate retry (1st failed: {type(e).__name__})")
                await _reset_session()
                continue
            logger.warning(f"translate failed ({type(e).__name__}: {e}) → speaking English")
            return text

    if out and out != text:
        logger.info(f"translate-out → {target_lang} ({len(out)} chars)")
        # Cache short lines only, and never cache a failed (unchanged) result.
        if len(text) <= _CACHE_MAX_LEN:
            _CACHE[key] = out
            _CACHE.move_to_end(key)
            if len(_CACHE) > _CACHE_MAX:
                _CACHE.popitem(last=False)   # evict least-recently-used
    else:
        logger.warning(f"translate-out returned unchanged text for {target_lang} (Sarvam kept it as-is?)")
    return out


async def translate_in(text: str, source_lang: str, timeout: float = 6.0) -> str:
    """Caller's speech (`source_lang`, e.g. 'hi-IN') → plain English, so the LLM always works
    in English and its reply always flows through translate_out (consistent code-mix for every
    language). No-op for English/empty/no-key. Returns original on failure (LLM still copes)."""
    text = (text or "").strip()
    if not text or not source_lang or source_lang.lower().startswith("en") or not _key():
        return text
    per_attempt = max(2.0, timeout / 2)
    for attempt in (1, 2):
        try:
            out = await _call(text, source_lang, "en-IN", "Female", "formal", None, per_attempt)
            if out and out != text:
                logger.info(f"translate-in ← {source_lang} ({len(text)}→{len(out)} chars)")
            return out
        except Exception as e:  # noqa: BLE001
            if attempt == 1:
                await _reset_session(); continue
            logger.warning(f"translate-in failed ({type(e).__name__}) → LLM gets original text")
            return text


async def prewarm(target_lang: str = "te-IN", gender: str = "Female",
                  mode: str = "modern-colloquial") -> None:
    """Open the TLS connection + warm Sarvam's backend so the FIRST real translate of
    the call runs warm (~0.3s) instead of cold (~0.7s). Safe to call fire-and-forget;
    never raises. Also seeds the cache with a common acknowledgement."""
    try:
        await translate_out("Thank you.", target_lang, gender=gender, mode=mode, timeout=6.0)
        logger.info(f"translate prewarmed for {target_lang}")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"translate prewarm skipped: {e}")


async def aclose() -> None:
    global _session
    if _session and not _session.closed:
        await _session.close()
