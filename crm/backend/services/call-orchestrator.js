// Integration layer connecting STT → Priya LLM → Gemini analytics.
// Previously imported from a missing Twilio subdirectory; now uses local services.
const sttService = require('./sttService')
const gemini     = require('./gemini')

class CallOrchestrator {
  async handleCallPipeline(callDocument, audioBuffer) {
    try {
      console.log(`[CallOrchestrator] Starting pipeline for call ${callDocument._id}`)

      // 1. Audio → Sarvam AI STT
      const transcriptText = await sttService.transcribe(audioBuffer)
      if (!transcriptText || !transcriptText.trim()) {
        console.log('[CallOrchestrator] Silence detected, aborting turn.')
        return null
      }

      // 2. Transcript → Gemini Flash analytics
      const fullTranscript = [
        { speaker: 'student', text: transcriptText, timestamp: Date.now() },
      ]
      const report = await gemini.parseTranscript({ call: callDocument, transcript: fullTranscript })

      console.log('[CallOrchestrator] Pipeline completed.')
      return report
    } catch (err) {
      console.error('[CallOrchestrator] Pipeline failed:', err)
      throw err
    }
  }
}

module.exports = new CallOrchestrator()
