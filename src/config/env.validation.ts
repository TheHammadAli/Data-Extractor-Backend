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
    BROWSER_HEADLESS: process.env.BROWSER_HEADLESS === 'true',
    BROWSER_CDP_ENDPOINT: process.env.BROWSER_CDP_ENDPOINT || undefined,
    DEFAULT_LISTING_LIMIT: Number(process.env.DEFAULT_LISTING_LIMIT ?? 50),
    CSV_STORAGE_DIR: process.env.CSV_STORAGE_DIR ?? './storage/csv',
  };
}
