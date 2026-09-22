import { Injectable } from '@nestjs/common';
import type { Locator, Page } from 'playwright';

export type PaginationMode = 'next' | 'load_more' | 'infinite_scroll';

export interface PaginationInfo {
  mode: PaginationMode;
  locator?: Locator;
}

@Injectable()
export class PaginationDetectorService {
  async detect(page: Page): Promise<PaginationInfo> {
    const nextByRel = page.locator('a[rel="next"]').first();
    if ((await nextByRel.count()) > 0) return { mode: 'next', locator: nextByRel };

    const nextByRole = page.getByRole('link', { name: /^\s*next\s*$/i }).or(page.getByRole('button', { name: /^\s*next\s*$/i }));
    if ((await nextByRole.count()) > 0) return { mode: 'next', locator: nextByRole.first() };

    const loadMore = page.getByRole('button', { name: /load more/i }).or(page.getByText(/load more/i));
    if ((await loadMore.count()) > 0) return { mode: 'load_more', locator: loadMore.first() };

    return { mode: 'infinite_scroll' };
  }

  async advance(page: Page, info: PaginationInfo): Promise<void> {
    if (info.locator) {
      await info.locator.click({ timeout: 8000 });
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    } else {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(800);
    }
  }
}
