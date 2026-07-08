// Compatibility shim — wraps our Sarvam AI STT so it can be dropped in
// anywhere the old Twilio-subdirectory sttService was expected.
// Returns a plain string (transcript text) to match the original API shape.
const { transcribe: sarvamTranscribe } = require('./sarvam')

async function transcribe(audioBuffer) {
  try {
    const result = await sarvamTranscribe(audioBuffer)
    return result.transcript || ''
  } catch (err) {
    console.warn('[sttService] Sarvam STT failed:', err.message)
    return ''
  }
}

module.exports = { transcribe }
