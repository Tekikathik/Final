"""
Reporter — pushes live call events from the LiveKit Priya agent back to the Node
backend so the AdmitAI dashboard shows the call in real time (transcript, collected
fields, step progress, status). It POSTs to  /api/priya/agent-event.

Design: fire-and-forget. emit() just drops a payload on an asyncio queue and returns
instantly, so reporting NEVER blocks the voice loop. A background task drains the
queue and POSTs each event. If BACKEND_REPORT_URL / session_id aren't set (e.g. a
plain `python agent.py console` test), it silently no-ops.
"""
import asyncio
import logging

import aiohttp

logger = logging.getLogger("priya.reporter")


class Reporter:
    def __init__(self, report_url: str | None, session_id: str | None):
        # report_url is the backend BASE url; the agent-event path is appended here.
        self.url = (report_url.rstrip("/") + "/api/priya/agent-event") if report_url else None
        self.session_id = session_id
        self.enabled = bool(self.url and self.session_id)
        self._queue: asyncio.Queue = asyncio.Queue()
        self._task: asyncio.Task | None = None
        self._http: aiohttp.ClientSession | None = None

    def start(self) -> None:
        if not self.enabled:
            logger.info("reporter disabled (no report_url / session_id) — running standalone")
            return
        self._task = asyncio.create_task(self._run())
        logger.info(f"reporter → {self.url}  session={self.session_id}")

    def emit(self, **payload) -> None:
        """Queue one event. Safe to call from sync event handlers; never blocks."""
        if not self.enabled:
            return
        payload["session_id"] = self.session_id
        try:
            self._queue.put_nowait(payload)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"reporter enqueue failed: {e}")

    async def _run(self) -> None:
        self._http = aiohttp.ClientSession()
        try:
            while True:
                payload = await self._queue.get()
                if payload is None:  # shutdown sentinel
                    break
                try:
                    await self._http.post(
                        self.url, json=payload,
                        timeout=aiohttp.ClientTimeout(total=5),
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"reporter POST failed ({payload.get('type')}): {e}")
        finally:
            await self._http.close()

    async def aclose(self) -> None:
        """Flush any queued events, then stop the worker. Call on agent shutdown."""
        if not self.enabled or not self._task:
            return
        self._queue.put_nowait(None)
        try:
            await asyncio.wait_for(self._task, timeout=4)
        except Exception:  # noqa: BLE001
            pass
