// ---------------------------------------------------------------------------
// Sarvam realtime streaming STT (saarika:v2.5) over WebSocket.
//
// Instead of buffering a whole utterance and POSTing it to the batch STT after
// the caller stops (a full round-trip of latency), we stream 8kHz PCM frames as
// they arrive. Sarvam runs its own VAD and returns the transcript the moment it
// detects end-of-speech — so by the time we finalize, the text is ready.
//
// Protocol (verified against the live API):
//   wss://api.sarvam.ai/speech-to-text/ws?language-code=..&model=saarika:v2.5
//        &mode=transcribe&sample_rate=8000&input_audio_codec=pcm_s16le
//   header: Api-Subscription-Key
//   send:   { audio: { data: <base64 pcm_s16le>, sample_rate:"8000", encoding:"audio/wav" } }
//   recv:   { type:"data", data:{ transcript, language_code, ... } }  |  { type:"error", ... }
//   end:    append a little trailing silence (nudges VAD), then close the socket.
// ---------------------------------------------------------------------------
const WebSocket = require('ws')

const SARVAM_WS = process.env.SARVAM_STT_WS_URL || 'wss://api.sarvam.ai/speech-to-text/ws'

class SarvamSttStream {
  constructor({ languageCode = 'en-IN' } = {}) {
    this.transcript = ''
    this.language   = null
    this.open       = false
    this.failed     = false
    this._queue     = []

    const params = new URLSearchParams({
      'language-code':    languageCode || 'en-IN',
      model:              'saarika:v2.5',
      mode:               'transcribe',
      sample_rate:        '8000',
      input_audio_codec:  'pcm_s16le',
    })

    try {
      this.ws = new WebSocket(`${SARVAM_WS}?${params}`, {
        headers: { 'Api-Subscription-Key': process.env.SARVAM_API_KEY },
      })
    } catch {
      this.failed = true
      return
    }

    this.ws.on('open', () => { this.open = true; this._flush() })
    this.ws.on('message', (d) => {
      try {
        const m = JSON.parse(d.toString())
        if (m.type === 'data' && m.data?.transcript) {
          // transcribe mode returns final segments between pauses — concatenate.
          this.transcript += (this.transcript ? ' ' : '') + m.data.transcript.trim()
          if (m.data.language_code) this.language = m.data.language_code
        } else if (m.type === 'error') {
          this.failed = true
        }
      } catch { /* ignore non-JSON */ }
    })
    this.ws.on('error', () => { this.failed = true })
    this.ws.on('close',  () => { this.open = false })
  }

  _send(b64) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ audio: { data: b64, sample_rate: '8000', encoding: 'audio/wav' } }))
    }
  }
  _flush() { for (const b of this._queue) this._send(b); this._queue = [] }

  // pcm: Int16Array of 8kHz samples
  sendPcm(pcm) {
    if (this.failed || !pcm?.length) return
    const b64 = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64')
    if (this.open) this._send(b64)
    else this._queue.push(b64)
  }

  // Return the live-streamed transcript the instant it's stable. Because the caller's
  // trailing silence was already streamed during endpoint detection, Sarvam has usually
  // ALREADY endpointed and the text is sitting here — so we seed lastLen with what we
  // have and break after a short settle window instead of re-waiting from scratch.
  //   STT_STABLE_MS  — settle window once text stops growing (default 120ms, was 250)
  //   STT_NUDGE_MS   — trailing silence to nudge VAD only if nothing arrived (default 300, was 600)
  async finalize(timeoutMs = 3000) {
    const STABLE_MS = parseInt(process.env.STT_STABLE_MS || '120', 10)
    const NUDGE_MS  = parseInt(process.env.STT_NUDGE_MS  || '300', 10)
    // Only nudge if no text has arrived yet — otherwise we already have the transcript.
    if (!this.transcript) this.sendPcm(new Int16Array(Math.round(8000 * (NUDGE_MS / 1000))))
    const start = Date.now()
    let lastLen     = this.transcript.length   // seed with current text, not -1
    let stableSince = Date.now()
    while (!this.failed && Date.now() - start < timeoutMs) {
      if (this.transcript.length !== lastLen) { lastLen = this.transcript.length; stableSince = Date.now() }
      else if (this.transcript && Date.now() - stableSince > STABLE_MS) break   // settled → done
      await new Promise(r => setTimeout(r, 25))   // poll faster (was 40ms)
    }
    try { this.ws.close() } catch { /* already closed */ }
    if (this.failed || !this.transcript) return null
    return { transcript: this.transcript, language: this.language }
  }

  abort() { try { this.ws.close() } catch { /* already closed */ } }
}

module.exports = { SarvamSttStream }
