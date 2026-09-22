export interface AppEnv {
  PORT: number;
  FRONTEND_ORIGIN: string;
  DATABASE_URL: string;
  AI_PROVIDER: 'mock' | 'anthropic' | 'gemini' | 'openrouter';
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  AI_MODEL?: string;
  BROWSER_HEADLESS: boolean;
  /**
   * "attach" drives the user's own browser over CDP (local use, keeps their logged-in session).
   * "launch" starts a browser of its own — the only option on a hosted server, where there is no
   * user browser to attach to and no screen to log in on.
   */
  BROWSER_MODE: 'attach' | 'launch';
  /** CDP endpoint of the user's own Chrome, started with --remote-debugging-port. */
  BROWSER_CDP_ENDPOINT?: string;
  DEFAULT_LISTING_LIMIT: number;
  CSV_STORAGE_DIR: string;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Reduces whatever was configured to a bare origin. CORS compares origins exactly, so pasting a
 * full page URL ("https://app.vercel.app/agent") into FRONTEND_ORIGIN makes every request fail
 * with an Access-Control-Allow-Origin that can never match.
 */
function toOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, '');
  }
}

function resolveBrowserMode(): 'attach' | 'launch' {
  return process.env.BROWSER_MODE === 'launch' ? 'launch' : 'attach';
}

/**
 * Headful is the right default locally (a human watches the run and solves CAPTCHAs), but a server
 * has no display at all — Chromium exits with "Missing X server or $DISPLAY". So launch mode, which
 * only exists for servers, defaults to headless.
 */
function resolveHeadless(): boolean {
  if (process.env.BROWSER_HEADLESS === undefined) return resolveBrowserMode() === 'launch';
  return process.env.BROWSER_HEADLESS === 'true';
}

export function loadAppEnv(): AppEnv {
  return {
    PORT: Number(process.env.PORT ?? 3001),
    FRONTEND_ORIGIN: toOrigin(process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000'),
    DATABASE_URL: requireEnv('DATABASE_URL'),
    AI_PROVIDER: (process.env.AI_PROVIDER as 'mock' | 'anthropic' | 'gemini' | 'openrouter') ?? 'mock',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || undefined,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || undefined,
    AI_MODEL: process.env.AI_MODEL || undefined,
    BROWSER_HEADLESS: resolveHeadless(),
    BROWSER_MODE: resolveBrowserMode(),
    BROWSER_CDP_ENDPOINT: process.env.BROWSER_CDP_ENDPOINT || undefined,
    DEFAULT_LISTING_LIMIT: Number(process.env.DEFAULT_LISTING_LIMIT ?? 50),
    CSV_STORAGE_DIR: process.env.CSV_STORAGE_DIR ?? './storage/csv',
  };
}
