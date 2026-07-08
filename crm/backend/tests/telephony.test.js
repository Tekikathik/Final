const axios = require('axios');
const { dispatchCall } = require('../services/telephony');

jest.mock('axios');

describe('Telephony Service', () => {
  const mockCall = {
    _id: 'call123',
    phone: '+1234567890',
    campaignId: 'camp123',
    collegeId: 'col123'
  };

  const mockCollege = {
    name: 'Test College'
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should run in mock mode if API key is not set', async () => {
    delete process.env.TELEPHONY_API_KEY;
    const result = await dispatchCall({ call: mockCall, college: mockCollege });
    expect(result.mock).toBe(true);
    expect(result.providerCallId).toBe('mock-call123');
  });

  it('should post to telephony provider if API key is set', async () => {
    process.env.TELEPHONY_API_URL = 'http://telephony-api.com';
    process.env.TELEPHONY_API_KEY = 'test-key';
    process.env.PUBLIC_BACKEND_URL = 'http://backend.com';
    process.env.TELEPHONY_FROM_NUMBER = '+0987654321';

    // Mock the create method to return an object with a post method
    const mockPost = jest.fn().mockResolvedValue({ data: { id: 'prov123' } });
    axios.create.mockReturnValue({ post: mockPost });
    
    // We need to re-require because axios.create is called on module load
    jest.resetModules();
    jest.mock('axios');
    const mockedAxios = require('axios');
    mockedAxios.create.mockReturnValue({ post: mockPost });
    const telephonyService = require('../services/telephony');

    const result = await telephonyService.dispatchCall({ call: mockCall, college: mockCollege });
    expect(result.providerCallId).toBe('prov123');
    expect(mockPost).toHaveBeenCalled();
  });
});
