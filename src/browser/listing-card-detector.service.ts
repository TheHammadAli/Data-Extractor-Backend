import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';

const MIN_GROUP_SIZE = 1;
const MIN_TEXT_LENGTH = 15;
const POLL_INTERVAL_MS = 500;

interface DomGroups {
  groups: string[][];
}

/**
 * Heuristic-first "find the repeated listing cards" detector: groups visible elements by
 * (parent signature + own tag), then picks the group pointing at the most distinct detail pages.
 * Groups keep document order, so "the first 5" means the first 5 as shown on the page.
 *
 * The DOM pass only collects candidate groups; choosing between them happens in Node so the
 * interesting logic stays unit-testable.
 *
 * MIN_GROUP_SIZE is intentionally 1, not 3+: a last page of paginated results can legitimately
 * have only one or two listings left, and picking the *largest available* group still favors a
 * real repeated grid over incidental one-off matches (those form their own singleton groups too).
 */
@Injectable()
export class ListingCardDetectorService {
  /**
   * Waits for the results to actually be there before answering. SPA sites render results after
   * the URL changes — measured on OLX: 0 ads 500ms after clicking a city (only the "popular
   * searches" links were on screen), all 25 by 1.5s. So only a non-empty list that holds still
   * across two reads is trusted; anything else keeps polling until the timeout.
   */
  async detectListingUrls(page: Page, timeoutMs = 20000): Promise<string[]> {
    const deadline = Date.now() + timeoutMs;
    let previous: string[] | null = null;

    for (;;) {
      const current = await this.readListingUrls(page);
      if (current.length > 0 && previous && this.sameList(previous, current)) return current;
      if (Date.now() >= deadline) return current;
      previous = current;
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }
  }

  private async readListingUrls(page: Page): Promise<string[]> {
    try {
      const { groups } = await this.collectGroups(page);
      return this.pickListingUrls(groups, page.url());
    } catch {
      // The page navigated mid-read ("execution context was destroyed") — just read again.
      return [];
    }
  }

  private sameList(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((url, i) => url === b[i]);
  }

  private async collectGroups(page: Page): Promise<DomGroups> {
    return page.evaluate(
      function collect(input: { minGroupSize: number; minTextLength: number }): DomGroups {
        function signature(el: Element): string {
          return el.tagName + '.' + Array.prototype.slice.call(el.classList).sort().join('.');
        }

        // No skipping of <nav>/<header>/<aside> here: sites don't use them faithfully — OLX wraps its
        // entire results grid in a <header>, which hid every card. Menus are rejected in Node by URL
        // shape instead, which doesn't depend on how the page is marked up.
        const grouped: { [key: string]: string[] } = {};
        const all: Element[] = Array.prototype.slice.call(document.body.querySelectorAll('*'));

        for (const el of all) {
          if (!el.parentElement) continue;

          // Cards often use an empty full-card overlay <a> with the title in a sibling element, so
          // the text is measured on the container rather than on the link itself.
          const anchor =
            el.tagName === 'A' ? (el as HTMLAnchorElement) : (el.querySelector('a[href]') as HTMLAnchorElement | null);
          if (!anchor) continue;

          const text = (el as HTMLElement).innerText ? (el as HTMLElement).innerText.trim() : '';
          if (text.length < input.minTextLength) continue;

          const href = anchor.href;
          if (!href) continue;

          // Keyed on the element's tag, not its classes: a featured/promoted card is styled with
          // different classes than its neighbours (OLX's first result is "li.f86388f3" among plain
          // "li"s) but sits in the same list, and dropping it would skip listing #1.
          const key = signature(el.parentElement) + '>' + el.tagName;
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(href);
        }

        const groups: string[][] = [];
        for (const key of Object.keys(grouped)) {
          if (grouped[key].length >= input.minGroupSize) groups.push(grouped[key]);
        }
        return { groups };
      },
      { minGroupSize: MIN_GROUP_SIZE, minTextLength: MIN_TEXT_LENGTH },
    );
  }

  /**
   * Picks the group pointing at the most distinct listing pages. A listing is an individual record
   * with a numeric id of its own; category menus, city filters, search suggestions and sort links
   * aren't, so they never qualify.
   *
   * No fallback to "the biggest group of links" when nothing qualifies — that fallback is how OLX's
   * "popular searches" links (".../q-google-pixel-pro") got queued as listings while the real
   * results were still loading. An empty answer lets the caller wait or ask the user instead.
   */
  pickListingUrls(groups: string[][], currentUrl: string): string[] {
    const indexShapes = this.indexShapesOf(currentUrl);
    const currentSegments = new Set(this.segmentsOf(currentUrl));
    let best: string[] = [];

    for (const group of groups) {
      const seen = new Set<string>();
      const urls: string[] = [];
      for (const href of group) {
        if (!this.isPlausibleListing(href, currentUrl)) continue;
        const shape = this.shapeOf(this.lastSegment(href));
        if (shape && indexShapes.has(shape)) continue;
        if (!this.hasOwnId(href, currentSegments)) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        urls.push(href);
      }
      if (urls.length > best.length) best = urls;
    }
    return best;
  }

  /**
   * True when the URL has a numeric id of its own — one not inherited from the results page, whose
   * city/category ids ("lahore_g4060673") every refinement link repeats. Five digits, so a year
   * like "2024" in a search slug doesn't count.
   */
  private hasOwnId(url: string, currentSegments: Set<string>): boolean {
    return this.segmentsOf(url).some((segment) => !currentSegments.has(segment) && /\d{5,}$/.test(segment));
  }

  private segmentsOf(url: string): string[] {
    return this.parse(url)?.pathname.split('/').filter(Boolean) ?? [];
  }

  private isPlausibleListing(href: string, currentUrl: string): boolean {
    const target = this.parse(href);
    const current = this.parse(currentUrl);
    if (!target) return false;
    if (current && target.origin !== current.origin) return false;
    if (current && this.withoutTrailingSlash(target) === this.withoutTrailingSlash(current)) return false;
    return target.pathname.replace(/\//g, '').length > 0;
  }

  /**
   * Every id marker in the results page's own URL. "/lahore_g4060673/mobile-phones_c1453" yields
   * {"_g#", "_c#"} — so sibling categories ("…_c2027") and city links ("karachi_g…") are both
   * recognisable as index pages, while an ad ("…-iid-1089" → "-iid-#") is not.
   */
  private indexShapesOf(url: string): Set<string> {
    const shapes = new Set<string>();
    const parsed = this.parse(url);
    if (!parsed) return shapes;
    for (const segment of parsed.pathname.split('/').filter(Boolean)) {
      const shape = this.shapeOf(segment);
      if (shape) shapes.add(shape);
    }
    return shapes;
  }

  /** The trailing id marker of a path segment with digits collapsed: "phones_c1453" → "_c#". */
  private shapeOf(segment: string | null): string | null {
    if (!segment) return null;
    const match = /([_-])([a-z]{0,6})(\d+)$/i.exec(segment);
    return match ? `${match[1]}${match[2].toLowerCase()}#` : null;
  }

  private lastSegment(url: string): string | null {
    const segments = this.parse(url)?.pathname.split('/').filter(Boolean) ?? [];
    return segments[segments.length - 1] ?? null;
  }

  private parse(url: string): URL | null {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }

  private withoutTrailingSlash(url: URL): string {
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  }
}
