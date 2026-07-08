const request = require('supertest');
const express = require('express');
const callsRouter = require('../routes/calls');

// Mocks
jest.mock('../models/Call');
jest.mock('../models/Report');
jest.mock('../models/College');
jest.mock('../services/gemini');
jest.mock('../services/scheduler');
jest.mock('../../Twilio/src/services/sttService');
jest.mock('axios');

const Call = require('../models/Call');
const Report = require('../models/Report');
const { parseTranscript } = require('../services/gemini');
const sttService = require('../../Twilio/src/services/sttService');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use('/api/calls', callsRouter);

describe('Webhook Pipeline Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should process the webhook, call Sarvam STT, Gemini extraction, and save report', async () => {
    const mockCall = {
      _id: 'call123',
      collegeId: 'col123',
      save: jest.fn().mockResolvedValue(true)
    };
    Call.findById.mockResolvedValue(mockCall);
    
    // Mock STT
    axios.get.mockResolvedValue({ data: Buffer.from('mock audio') });
    sttService.transcribe.mockResolvedValue('Hello this is a student');
    
    // Mock Gemini
    parseTranscript.mockResolvedValue({
      profile: { name: 'Test Student' },
      summary: 'Test summary',
      _callPatch: { sentiment: 'positive', interested: true }
    });

    // Mock Report
    Report.findOneAndUpdate.mockResolvedValue({ _id: 'rep123' });

    const response = await request(app)
      .post('/api/calls/webhook')
      .send({
        callId: 'call123',
        status: 'completed',
        duration: 120,
        recordingUrl: 'http://example.com/audio.wav'
      });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Webhook processed');
    expect(sttService.transcribe).toHaveBeenCalled();
    expect(parseTranscript).toHaveBeenCalled();
    expect(mockCall.save).toHaveBeenCalled();
    expect(mockCall.sentiment).toBe('positive');
    expect(mockCall.name).toBe('Test Student');
    expect(Report.findOneAndUpdate).toHaveBeenCalled();
  });
});
