import { BrowserSessionManager } from './browser-session-manager.service.js';

/** Stands in for a machine with no Chromium — a hosted server, typically. */
class NoBrowserSessionManager extends BrowserSessionManager {
  protected override browserExecutablePath(): string {
    return '/no/such/chromium';
  }
}

describe('BrowserSessionManager without a launchable browser', () => {
  const env = { BROWSER_CDP_ENDPOINT: 'http://127.0.0.1:9', BROWSER_HEADLESS: true } as never;

  it('reports the failure instead of taking the process down', async () => {
    const manager = new NoBrowserSessionManager(env);

    // A failed spawn emits an unhandled 'error' event that kills the whole Node process, which
    // reaches the browser as "Failed to fetch" with no response — so it has to reject cleanly.
    await expect(manager.openManagedBrowser()).rejects.toThrow(/Could not start a browser/);
  }, 30000);

  it('says a run cannot attach when nothing is reachable', async () => {
    const manager = new NoBrowserSessionManager(env);

    await expect(manager.attach('run-1')).rejects.toThrow(/No CDP-enabled browser is running/);
  }, 30000);
});
