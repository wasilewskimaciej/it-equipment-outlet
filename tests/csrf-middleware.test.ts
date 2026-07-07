import { beforeAll, describe, expect, it, vi } from 'vitest';

type CsrfModule = typeof import('../src/middleware/csrf.middleware');

let csrfModule: CsrfModule;

function createResponseMock() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis()
  };

  return res;
}

describe('csrfProtection', () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = 'test-session-secret';
    process.env.BASE_URL = 'http://localhost:3000';
    csrfModule = await import('../src/middleware/csrf.middleware');
  });

  it('allows same-origin authenticated POST requests', () => {
    const req = {
      method: 'POST',
      originalUrl: '/api/reservations',
      headers: {
        origin: 'http://localhost:3000'
      },
      isAuthenticated: () => true,
      user: { id: 'u1', email: 'u1@example.com' }
    } as any;
    const res = createResponseMock();
    const next = vi.fn();

    csrfModule.csrfProtection(req, res as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks cross-site authenticated POST requests', () => {
    const req = {
      method: 'POST',
      originalUrl: '/api/reservations',
      headers: {
        origin: 'https://evil.example'
      },
      isAuthenticated: () => true,
      user: { id: 'u1', email: 'u1@example.com' }
    } as any;
    const res = createResponseMock();
    const next = vi.fn();

    csrfModule.csrfProtection(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid request origin' });
  });

  it('allows the Microsoft OAuth callback even though it is cross-site', () => {
    const req = {
      method: 'POST',
      originalUrl: '/auth/callback',
      headers: {
        origin: 'https://login.microsoftonline.com'
      },
      isAuthenticated: () => false
    } as any;
    const res = createResponseMock();
    const next = vi.fn();

    csrfModule.csrfProtection(req, res as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
