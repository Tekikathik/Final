"""
Per-turn latency tracking for the Priya voice agent.

LiveKit emits a `metrics_collected` event with EOU / LLM / TTS metrics each turn.
The caller-perceived response latency (caller stops talking → Priya starts talking)
is essentially:

    end_of_utterance_delay  +  LLM time-to-first-token  +  TTS time-to-first-byte

This collects those three per turn and appends a row to latency_log.csv, which
plot_latency.py turns into a chart.
"""
import os
import csv
import time
import logging

from livekit.agents import metrics

logger = logging.getLogger("priya.latency")

CSV_PATH = os.path.join(os.path.dirname(__file__), "latency_log.csv")
HEADER = ["timestamp", "session_id", "turn", "eou_delay", "llm_ttft", "tts_ttfb", "total"]


class LatencyTracker:
    def __init__(self, session_id: str = "", path: str = CSV_PATH):
        self.path = path
        self.session_id = session_id or "console"
        self._turn: dict = {}
        self._n = 0
        self._await_tts = False   # only the TTS that follows an LLM reply counts
        if not os.path.exists(self.path):
            with open(self.path, "w", newline="", encoding="utf-8") as f:
                csv.writer(f).writerow(HEADER)

    def collect(self, m) -> None:
        """Feed a LiveKit metrics object. A row is written on the reply's TTS — i.e. the
        first TTS AFTER an LLM call — so the pre-LLM filler ('Okay'/'Sure') and the fixed
        greeting (which have no LLM) don't trigger a premature, mis-attributed flush."""
        if isinstance(m, metrics.EOUMetrics):
            self._turn["eou"] = float(getattr(m, "end_of_utterance_delay", 0.0) or 0.0)
        elif isinstance(m, metrics.LLMMetrics):
            self._turn["llm"] = float(getattr(m, "ttft", 0.0) or 0.0)
            self._await_tts = True
        elif isinstance(m, metrics.TTSMetrics):
            if not self._await_tts:
                return  # filler / greeting TTS — ignore
            self._turn["tts"] = float(getattr(m, "ttfb", 0.0) or 0.0)
            self._await_tts = False
            self._flush()

    def _flush(self) -> None:
        eou = self._turn.get("eou", 0.0)
        llm = self._turn.get("llm", 0.0)
        tts = self._turn.get("tts", 0.0)
        total = eou + llm + tts
        self._n += 1
        try:
            with open(self.path, "a", newline="", encoding="utf-8") as f:
                csv.writer(f).writerow([
                    int(time.time()), self.session_id, self._n,
                    f"{eou:.3f}", f"{llm:.3f}", f"{tts:.3f}", f"{total:.3f}",
                ])
        except Exception as e:  # noqa: BLE001
            logger.warning(f"latency log write failed: {e}")
        logger.info(f"⏱ turn {self._n}: EOU {eou:.2f}s + LLM {llm:.2f}s + TTS {tts:.2f}s = {total:.2f}s total")
        self._turn = {}
