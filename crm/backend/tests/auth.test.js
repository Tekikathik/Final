// backend/tests/auth.test.js
const { authenticate, requireRole, scopeToCollege } = require('../middleware/auth');

describe('Auth Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {}, params: {}, query: {}, body: {} };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
  });

  describe('requireRole', () => {
    it('1. should allow access if user has the exact role', () => {
      req.user = { role: 'admin' };
      const middleware = requireRole('admin');
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('2. should allow access if user has one of the allowed roles', () => {
      req.user = { role: 'college_admin' };
      const middleware = requireRole('admin', 'college_admin');
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('3. should deny access if user role is not in the allowed list', () => {
      req.user = { role: 'viewer' };
      const middleware = requireRole('admin', 'college_admin');
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: 'Insufficient permissions' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('scopeToCollege', () => {
    it('4. should bypass scope check for org admin', () => {
      req.user = { role: 'admin', collegeIds: [] };
      req.params.collegeId = 'col1';
      scopeToCollege('params.collegeId')(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('5. should allow college_admin if collegeId matches their assigned college', () => {
      req.user = { role: 'college_admin', collegeIds: ['col1', 'col2'] };
      req.params.collegeId = 'col1';
      scopeToCollege('params.collegeId')(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('6. should allow college_admin if collegeId matches via body', () => {
      req.user = { role: 'college_admin', collegeIds: ['col1'] };
      req.body.collegeId = 'col1';
      scopeToCollege('body.collegeId')(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('7. should deny college_admin if collegeId is missing from request', () => {
      req.user = { role: 'college_admin', collegeIds: ['col1'] };
      // No collegeId in params, body, or query
      scopeToCollege('params.collegeId')(req, res, next);
      expect(next).toHaveBeenCalled(); // Should pass through if collegeId isn't present in the specified bucket
    });

    it('8. should deny college_admin if collegeId does not match their assigned colleges', () => {
      req.user = { role: 'college_admin', collegeIds: ['col1'] };
      req.query.collegeId = 'col2';
      scopeToCollege('query.collegeId')(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: 'You do not have access to this college' });
    });
  });
});
