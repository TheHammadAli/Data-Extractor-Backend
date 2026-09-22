import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { APP_ENV } from '../config/config.module.js';
import type { AppEnv } from '../config/env.validation.js';

interface Session {
  browser?: Browser;
  context: BrowserContext;
  page: Page;
  /** True when this is the user's own browser: never close it or its context, just detach. */
  attached?: boolean;
}

const MANAGED_PROFILE_DIR = 'storage/browser-profile';
const MANAGED_CDP_PORT = 9333;

export interface AttachResult {
  page: Page;
  /** How the page was obtained, for reporting back into the run log. */
  how: 'existing-tab' | 'new-tab-same-session';
  endpoint: string;
}

/**
 * Drives the *user's own* browser rather than an isolated automation browser.
 *
 * Chrome only speaks CDP when it was started with `--remote-debugging-port`, and since Chrome 136
 * that flag is ignored on the default profile unless a non-default `--user-data-dir` is also given.
 * So there are two supported ways to get an attachable browser:
 *   1. The user starts their own Chrome with those flags (BROWSER_CDP_ENDPOINT, default :9222).
 *   2. They press "Open Browser", which spawns a CDP-enabled Chrome on :9333 — detached, so it
 *      survives backend restarts and keeps whatever the user logged into.
 *
 * Either way the agent attaches to the *existing* context: the user's cookies, logins and tabs are
 * used as-is and never cleared, and the browser is never closed out from under them.
 */
@Injectable()
export class BrowserSessionManager implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserSessionManager.name);
  private readonly sessions = new Map<string, Session>();

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  private get endpoints(): string[] {
    const configured = this.env.BROWSER_CDP_ENDPOINT || 'http://127.0.0.1:9222';
    const managed = `http://127.0.0.1:${MANAGED_CDP_PORT}`;
    return configured === managed ? [managed] : [configured, managed];
  }

  /** Spawns a CDP-enabled Chrome for users who don't want to add the flags themselves. */
  async openManagedBrowser(url?: string): Promise<void> {
    if (await this.findAttachableEndpoint()) {
      const session = await this.attachTo(url);
      if (session && url) {
        await session.page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      }
      await session?.browser?.close().catch(() => undefined);
      return;
    }

    // Detached on purpose: a Playwright-launched browser is a child wired to this process by a
    // pipe and dies on every backend restart, throwing away the login the user just did.
    const userDataDir = resolve(process.cwd(), MANAGED_PROFILE_DIR);
    let spawnError: Error | null = null;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        this.browserExecutablePath(),
        [
          `--remote-debugging-port=${MANAGED_CDP_PORT}`,
          `--user-data-dir=${userDataDir}`,
          '--no-first-run',
          '--no-default-browser-check',
          url ?? 'about:blank',
        ],
        { detached: true, stdio: 'ignore' },
      );
    } catch (err) {
      throw new Error(this.cannotStartMessage(err as Error));
    }

    // Without this listener a failed spawn (no Chromium installed — the usual case on a hosted
    // server) emits an unhandled 'error' event, which takes the whole backend process down and
    // shows up in the browser as "Failed to fetch" with no response at all.
    child.on('error', (err) => {
      spawnError = err;
      this.logger.error(`Could not start a browser: ${err.message}`);
    });
    child.unref();

    const endpoint = `http://127.0.0.1:${MANAGED_CDP_PORT}`;
    if (!(await this.waitForEndpoint(endpoint, 20000, () => spawnError !== null))) {
      const failure = spawnError as Error | null;
      throw new Error(
        failure ? this.cannotStartMessage(failure) : 'The browser did not finish starting up. Please try again.',
      );
    }
  }

  /** Overridable so tests can point at a path that cannot be launched. */
  protected browserExecutablePath(): string {
    return chromium.executablePath();
  }

  private cannotStartMessage(err: Error): string {
    return (
      `Could not start a browser on the machine running this backend (${err.message}). ` +
      'The agent drives a real browser, so the backend has to run on your own computer — ' +
      'a hosted server has no browser and no screen for you to log in on.'
    );
  }

  /** True when some CDP-enabled browser is reachable and usable. Server mode always has one. */
  async isBrowserAvailable(): Promise<boolean> {
    if (this.env.BROWSER_MODE === 'launch') return true;
    return !!(await this.findAttachableEndpoint());
  }

  get mode(): 'attach' | 'launch' {
    return this.env.BROWSER_MODE;
  }

  /** Closes only the browser this service spawned; a user-run browser is left alone. */
  async closeManagedBrowser(): Promise<void> {
    const endpoint = `http://127.0.0.1:${MANAGED_CDP_PORT}`;
    if (!(await this.probe(endpoint))) return;
    try {
      const browser = await chromium.connectOverCDP(endpoint);
      // Over CDP, browser.close() only disconnects — closing every tab is what makes Chrome exit.
      for (const context of browser.contexts()) {
        for (const page of context.pages()) {
          await page.close().catch(() => undefined);
        }
      }
      await browser.close().catch(() => undefined);
    } catch (err) {
      this.logger.warn(`Error closing managed browser: ${err}`);
    }
  }

  /**
   * Attaches to the user's running browser and returns the tab to work in: the one already showing
   * the target site when there is one, otherwise a new tab *in the same session*.
   */
  async attach(runId: string, targetUrl?: string): Promise<AttachResult> {
    const existing = this.sessions.get(runId);
    if (existing) return { page: existing.page, how: 'existing-tab', endpoint: 'already-attached' };

    if (this.env.BROWSER_MODE === 'launch') return this.launchOwnBrowser(runId);

    const endpoint = await this.findAttachableEndpoint();
    if (!endpoint) throw new Error(this.notAttachableMessage());

    const session = await this.attachTo(targetUrl);
    if (!session) throw new Error(this.notAttachableMessage());

    this.sessions.set(runId, session);
    return {
      page: session.page,
      how: session.matchedExistingTab ? 'existing-tab' : 'new-tab-same-session',
      endpoint,
    };
  }

  /**
   * Server mode: no user browser exists to attach to, so run one of our own. The session is not
   * marked `attached`, so it gets closed when the run ends.
   */
  private async launchOwnBrowser(runId: string): Promise<AttachResult> {
    const browser = await this.launchChromium();
    const context = await browser.newContext();
    const page = await context.newPage();
    this.sessions.set(runId, { browser, context, page });
    return { page, how: 'new-tab-same-session', endpoint: 'launched' };
  }

  /**
   * A headed browser cannot start where there is no display ("Missing X server or $DISPLAY"), and
   * that is configuration nobody can act on mid-run — so fall back to headless rather than failing.
   */
  private async launchChromium(): Promise<Browser> {
    try {
      return await chromium.launch({ headless: this.env.BROWSER_HEADLESS });
    } catch (err) {
      if (this.env.BROWSER_HEADLESS) throw err;
      this.logger.warn(`Could not start a headed browser (${(err as Error).message}); retrying headless.`);
      return chromium.launch({ headless: true });
    }
  }

  private async attachTo(targetUrl?: string): Promise<(Session & { matchedExistingTab: boolean }) | null> {
    const endpoint = await this.findAttachableEndpoint();
    if (!endpoint) return null;
    try {
      const browser = await chromium.connectOverCDP(endpoint);
      const context = browser.contexts()[0];
      if (!context) {
        await browser.close().catch(() => undefined);
        return null;
      }

      const matched = targetUrl ? this.findTabFor(context, targetUrl) : undefined;
      const page = matched ?? context.pages()[0] ?? (await context.newPage());
      await page.bringToFront().catch(() => undefined);

      return { browser, context, page, attached: true, matchedExistingTab: !!matched };
    } catch (err) {
      this.logger.warn(`Could not attach over CDP: ${err}`);
      return null;
    }
  }

  /** Prefers an exact URL match, then any tab already on the same site. */
  private findTabFor(context: BrowserContext, targetUrl: string): Page | undefined {
    const pages = context.pages();
    const exact = pages.find((p) => p.url() === targetUrl);
    if (exact) return exact;
    const targetOrigin = this.originOf(targetUrl);
    if (!targetOrigin) return undefined;
    return pages.find((p) => this.originOf(p.url()) === targetOrigin);
  }

  private originOf(url: string): string | null {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }

  private async findAttachableEndpoint(): Promise<string | null> {
    for (const endpoint of this.endpoints) {
      if (await this.probe(endpoint)) return endpoint;
    }
    return null;
  }

  private async probe(endpoint: string): Promise<boolean> {
    try {
      const res = await fetch(`${endpoint.replace(/\/$/, '')}/json/version`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async waitForEndpoint(endpoint: string, timeoutMs = 20000, abort?: () => boolean): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.probe(endpoint)) return true;
      if (abort?.()) return false;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  }

  private notAttachableMessage(): string {
    return [
      'No CDP-enabled browser is running, so there is no existing session to use.',
      'Either press "Open Browser" on the agent page, or start Chrome yourself with:',
      `chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\\chrome-agent-profile"`,
      '(Chrome ignores the debugging port on its default profile, so a separate --user-data-dir is required.)',
    ].join(' ');
  }

  get(runId: string): Page | undefined {
    return this.sessions.get(runId)?.page;
  }

  /** Detaches from the user's browser without closing it, its tabs, or its session data. */
  async close(runId: string): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session) return;
    this.sessions.delete(runId);
    if (session.attached) {
      await session.browser?.close().catch(() => undefined); // disconnect only
      return;
    }
    await session.context.close().catch(() => undefined);
    await session.browser?.close().catch((err) => this.logger.warn(`Error closing browser: ${err}`));
  }

  async onModuleDestroy() {
    await Promise.all(Array.from(this.sessions.keys()).map((runId) => this.close(runId)));
  }
}
