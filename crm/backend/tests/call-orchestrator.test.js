// backend/tests/call-orchestrator.test.js
process.env.TWILIO_ACCOUNT_SID = 'AC123';
process.env.TWILIO_AUTH_TOKEN = '123';
process.env.TWILIO_PHONE_NUMBER = '+1234567890';
process.env.TWILIO_WORKSPACE_SID = 'WS123';
process.env.TWILIO_WORKFLOW_SID = 'WW123';
process.env.TWILIO_APP_SID = 'AP123';
process.env.TELEPHONY_API_URL = 'http://test';
process.env.TELEPHONY_API_KEY = 'test';
process.env.TELEPHONY_FROM_NUMBER = '+1234567890';

const callOrchestrator = require('../services/call-orchestrator');

jest.mock('../../Twilio/src/services/twilioService', () => ({
  makeCall: jest.fn()
}));
jest.mock('../../Twilio/src/services/sttService', () => ({
  transcribe: jest.fn()
}));
jest.mock('../../Twilio/src/services/ragService', () => ({
  stream: jest.fn((text, ctx, onChunk, onDone) => {
    onChunk('This is a mock RAG response');
    onDone();
  })
}));
jest.mock('../services/gemini', () => ({
  parseTranscript: jest.fn()
}));

const twilioService = require('../../Twilio/src/services/twilioService');
const sttService = require('../../Twilio/src/services/sttService');
const gemini = require('../services/gemini');

describe('Call Orchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. should initiate a Twilio call', async () => {
    twilioService.makeCall.mockResolvedValueOnce({ callSid: 'CA123' });
    const result = await callOrchestrator.initiateCall('+123456', '+654321');
    expect(result.callSid).toBe('CA123');
    expect(twilioService.makeCall).toHaveBeenCalledWith('+123456', '+654321');
  });

  it('2. should handle full call pipeline (STT -> RAG -> Gemini)', async () => {
    sttService.transcribe.mockResolvedValueOnce('Hello from user');
    gemini.parseTranscript.mockResolvedValueOnce({
      profile: { name: 'Test' },
      summary: 'Test summary'
    });

    const callDoc = { _id: 'call123' };
    const audioBuffer = Buffer.from('mock-audio');

    const result = await callOrchestrator.handleCallPipeline(callDoc, audioBuffer);
    
    expect(sttService.transcribe).toHaveBeenCalledWith(audioBuffer);
    expect(gemini.parseTranscript).toHaveBeenCalled();
    expect(result.profile.name).toBe('Test');
    expect(result.summary).toBe('Test summary');
  });

  it('3. should abort pipeline if STT detects silence', async () => {
    sttService.transcribe.mockResolvedValueOnce('   ');

    const result = await callOrchestrator.handleCallPipeline({ _id: 'call123' }, Buffer.from(''));
    
    expect(sttService.transcribe).toHaveBeenCalled();
    expect(gemini.parseTranscript).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
