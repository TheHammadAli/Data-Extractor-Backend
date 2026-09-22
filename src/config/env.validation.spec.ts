import { loadAppEnv } from './env.validation.js';

describe('loadAppEnv FRONTEND_ORIGIN', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it.each([
    ['a full page URL', 'https://app.vercel.app/agent', 'https://app.vercel.app'],
    ['a trailing slash', 'https://app.vercel.app/', 'https://app.vercel.app'],
    ['a bare origin', 'https://app.vercel.app', 'https://app.vercel.app'],
    ['a port', 'http://localhost:3000/results', 'http://localhost:3000'],
  ])('reduces %s to the origin CORS can match', (_label, configured, expected) => {
    process.env.FRONTEND_ORIGIN = configured;

    expect(loadAppEnv().FRONTEND_ORIGIN).toBe(expected);
  });

  it('falls back to the local dev origin when unset', () => {
    delete process.env.FRONTEND_ORIGIN;

    expect(loadAppEnv().FRONTEND_ORIGIN).toBe('http://localhost:3000');
  });
});
