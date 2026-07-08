// backend/tests/gemini.test.js
const { parseTranscript } = require('../services/gemini');

// We don't need to mock GoogleGenerativeAI before require because it handles null fallback when API key is missing.
// But we want to test both fallback and actual generation. Since it's instantiated at load time,
// if GEMINI_API_KEY wasn't set, model is null. Let's mock it using jest.mock.

jest.mock('@google/generative-ai', () => {
  const mModel = {
    generateContent: jest.fn().mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          profile: { name: 'Test Student', phone: '+123456' },
          summary: 'Student is interested in B.Tech CSE.',
          enrollmentProbability: 85,
          sentiment: 'positive',
          interested: true,
          topicAnalysis: { fees: 50 },
          sentimentTimeline: [],
          followUpRecommendations: ['Send email']
        })
      }
    })
  };
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockReturnValue(mModel)
    }))
  };
});

// Since gemini.js already evaluated without GEMINI_API_KEY if we didn't set it,
// the model inside might be null. Let's force it by resetting modules.
let parseTranscriptFn;
let mModel;

describe('Gemini Service', () => {
  beforeAll(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    jest.resetModules();
    const gemini = require('../services/gemini');
    parseTranscriptFn = gemini.parseTranscript;

    // To verify we can change mock return value
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    mModel = new GoogleGenerativeAI().getGenerativeModel();
  });

  afterAll(() => {
    delete process.env.GEMINI_API_KEY;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. should parse transcript successfully and map to Report shape', async () => {
    const call = { _id: 'call123', collegeId: 'col1', orgId: 'org1', phone: '+123456' };
    const transcript = [
      { speaker: 'ai', text: 'Hello' },
      { speaker: 'student', text: 'Hi, I want to know about B.Tech CSE fees.' }
    ];

    const result = await parseTranscriptFn({ call, transcript, webhookPayload: { test: 1 } });
    
    expect(result.callId).toBe('call123');
    expect(result.profile.name).toBe('Test Student');
    expect(result.enrollmentProbability).toBe(85);
    expect(result.summary).toContain('B.Tech');
    expect(result.transcript.length).toBe(2);
    expect(mModel.generateContent).toHaveBeenCalled();
  });

  it('2. should handle missing or empty transcript by falling back to heuristics', async () => {
    const call = { _id: 'call123', collegeId: 'col1', orgId: 'org1', name: 'Fallback User' };
    const result = await parseTranscriptFn({ call, transcript: [] });
    
    expect(result.profile.name).toBe('Fallback User');
    expect(mModel.generateContent).not.toHaveBeenCalled();
    // It should have some dummy summary from heuristics
    expect(typeof result.summary).toBe('string');
  });

  it('3. should handle API errors and fallback gracefully', async () => {
    mModel.generateContent.mockRejectedValueOnce(new Error('API quota exceeded'));
    const call = { _id: 'call123', collegeId: 'col1', orgId: 'org1', name: 'Fallback User' };
    const transcript = [{ speaker: 'student', text: 'Hi' }];
    
    const result = await parseTranscriptFn({ call, transcript });
    
    expect(result.profile.name).toBe('Fallback User');
    expect(mModel.generateContent).toHaveBeenCalled();
    // It should have fallback summary
    expect(typeof result.summary).toBe('string');
  });

  it('4. should clamp values correctly', async () => {
    mModel.generateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          enrollmentProbability: 150, // Should clamp to 100
          topicAnalysis: { fees: -10 } // Should clamp to 0
        })
      }
    });

    const call = { _id: 'call123' };
    const transcript = [{ speaker: 'student', text: 'Hi' }];
    const result = await parseTranscriptFn({ call, transcript });

    expect(result.enrollmentProbability).toBe(100);
    expect(result.topicAnalysis.fees).toBe(0);
  });
});
