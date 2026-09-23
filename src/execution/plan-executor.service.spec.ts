import type { Page } from 'playwright';
import { PlanExecutorService } from './plan-executor.service.js';
import type { InstructionPlan } from '../ai/ai.types.js';
import { NormalizationService } from '../normalization/normalization.service.js';

const RESULTS_URL = 'https://www.olx.com.pk/mobile-phones_c1453/lahore';
/** Ids are 10 digits like the real ones — listings are matched by id, not by slug. */
const QUEUED = [1, 2, 3, 4, 5].map((n) => `https://www.olx.com.pk/item/listing-${n}-iid-111944683${n}`);
/** What a detail page would offer up as "similar/recommended" ads. */
const UNRELATED = [9, 8].map((n) => `https://www.olx.com.pk/item/unrelated-${n}-iid-111944699${n}`);

interface Harness {
  service: PlanExecutorService;
  page: Page;
  upserted: string[];
  rows: Record<string, string>[];
  aiPageTexts: string[];
  events: { type: string; message: string }[];
  detectCalls: string[];
  counters: { extractedCount: number; failedCount: number; progressCurrent: number; progressTotal: number };
}

interface HarnessOptions {
  redirectFrom?: string;
  redirectTo?: string;
  emptyFirst?: boolean;
  /** Successive visible-text reads; the last one repeats. */
  texts?: string[];
  aiData?: Record<string, string>;
  mode?: 'attach' | 'launch';
  /** Whether grounded clicks/selects succeed. */
  groundSucceeds?: boolean;
  startUrl?: string;
}

function makeHarness(options: HarnessOptions = {}): Harness {
  let currentUrl = options.startUrl ?? RESULTS_URL;
  const upserted: string[] = [];
  const rows: Record<string, string>[] = [];
  const aiPageTexts: string[] = [];
  const events: { type: string; message: string }[] = [];
  const detectCalls: string[] = [];
  const texts = [...(options.texts ?? ['page text'])];

  const page = {
    url: () => currentUrl,
    goto: async (target: string) => {
      currentUrl = options.redirectFrom === target ? (options.redirectTo as string) : target;
      return null;
    },
    waitForTimeout: async () => undefined,
  } as unknown as Page;

  const listingCardDetector = {
    detectListingUrls: async (p: Page) => {
      detectCalls.push(p.url());
      if (options.emptyFirst && detectCalls.length === 1) return [];
      // A detail page only ever offers unrelated links; the results page offers the real queue.
      return p.url() === RESULTS_URL ? [...QUEUED] : [...UNRELATED];
    },
  };

  const counters = { extractedCount: 0, failedCount: 0, progressCurrent: 0, progressTotal: 0 };
  const prisma = {
    withRetry: <T>(operation: () => Promise<T>) => operation(),
    run: {
      // Mirrors Prisma's { increment } semantics so the counters can be asserted on.
      update: async ({ data }: { data: Record<string, { increment?: number } | undefined> }) => {
        for (const key of ['extractedCount', 'failedCount', 'progressCurrent'] as const) {
          const increment = data[key]?.increment;
          if (increment) counters[key] += increment;
        }
        return counters;
      },
    },
    extractedListing: {
      upsert: async ({ create }: { create: { listingUrl: string; data: Record<string, string> } }) => {
        upserted.push(create.listingUrl);
        rows.push(create.data);
        return {};
      },
    },
  };

  const service = new PlanExecutorService(
    {
      extractListingFields: async ({ pageText }: { pageText: string }) => {
        aiPageTexts.push(pageText);
        return { data: options.aiData ?? { title: 'A title' } };
      },
    } as never,
    { DEFAULT_LISTING_LIMIT: 50, BROWSER_MODE: options.mode ?? 'attach' } as never,
    prisma as never,
    { emit: async (e: { type: string; message: string }) => void events.push(e) } as never,
    { groundAndAct: async () => ({ success: options.groundSucceeds ?? true }) } as never,
    { readVisibleText: async () => (texts.length > 1 ? (texts.shift() as string) : texts[0]) } as never,
    { check: async () => 'none' } as never,
    listingCardDetector as never,
    { detect: async () => ({}), advance: async () => undefined } as never,
    new NormalizationService(),
    { computeKey: (input: { listingUrl: string }) => input.listingUrl } as never,
    { peek: () => undefined, wipe: () => undefined } as never,
    { isCancelled: () => false, waitForResume: async () => undefined } as never,
  );

  return { service, page, upserted, rows, aiPageTexts, events, detectCalls, counters };
}

const plan: InstructionPlan = {
  steps: [{ type: 'find_listings' }, { type: 'extract', fields: ['title'] }],
  fieldList: ['title'],
  listingLimit: 5,
};

describe('PlanExecutorService listing queue', () => {
  it('processes exactly the queued listings and nothing discovered inside them', async () => {
    const h = makeHarness();

    await h.service.run('run-1', h.page, plan, RESULTS_URL);

    expect(h.upserted).toEqual(QUEUED);
    for (const unrelated of UNRELATED) {
      expect(h.upserted).not.toContain(unrelated);
    }
  });

  it('only ever discovers listings from the results page, never from a detail page', async () => {
    const h = makeHarness();

    await h.service.run('run-2', h.page, plan, RESULTS_URL);

    expect(h.detectCalls).toEqual([RESULTS_URL]);
  });

  it('refuses to extract when the browser lands on a different listing than the queued one', async () => {
    const h = makeHarness({ redirectFrom: QUEUED[2], redirectTo: UNRELATED[0] });

    await h.service.run('run-3', h.page, plan, RESULTS_URL);

    expect(h.upserted).not.toContain(UNRELATED[0]);
    expect(h.upserted).not.toContain(QUEUED[2]);
    expect(h.upserted).toEqual([QUEUED[0], QUEUED[1], QUEUED[3], QUEUED[4]]);
    expect(h.events.some((e) => e.type === 'STEP_FAILED' && e.message.includes(QUEUED[2]))).toBe(true);
  });

  it('pauses for the user instead of finishing empty when no listings are detected', async () => {
    const h = makeHarness({ emptyFirst: true });

    await h.service.run('run-4', h.page, plan, RESULTS_URL);

    expect(h.events.some((e) => e.type === 'PAUSE' && e.message.startsWith('No listings found'))).toBe(true);
    expect(h.upserted).toEqual(QUEUED);
  });
});

describe('PlanExecutorService when a step needs a human', () => {
  const locationPlan: InstructionPlan = {
    steps: [{ type: 'select_location', value: 'Lahore' }, { type: 'find_listings' }, { type: 'extract', fields: ['title'] }],
    fieldList: ['title'],
    listingLimit: 5,
  };

  it('fails the run in launch mode rather than asking the user to fix a browser they cannot see', async () => {
    const h = makeHarness({ mode: 'launch', groundSucceeds: false });

    await expect(h.service.run('run-8', h.page, locationPlan, RESULTS_URL)).rejects.toThrow(/cannot see or click/);
    expect(h.upserted).toEqual([]);
  });

  it('still pauses for the user in attach mode', async () => {
    const h = makeHarness({ groundSucceeds: false });

    await h.service.run('run-9', h.page, locationPlan, RESULTS_URL);

    expect(h.events.some((e) => e.type === 'PAUSE' && e.message.includes('Lahore'))).toBe(true);
  });

  it('refuses to build a queue from the site home page', async () => {
    // The home page's category grid looks exactly like a results grid to the detector.
    const h = makeHarness({ startUrl: 'https://www.olx.com.pk/' });

    await h.service.run('run-10', h.page, { ...locationPlan, steps: locationPlan.steps.slice(1) }, RESULTS_URL);

    expect(h.events.some((e) => e.type === 'PAUSE' && e.message.includes('home page'))).toBe(true);
  });
});

describe('PlanExecutorService counters and listing identity', () => {
  it('counts a listing as extracted or failed, never both', async () => {
    const h = makeHarness({ redirectFrom: QUEUED[2], redirectTo: 'https://www.olx.com.pk/item/somewhere-else-iid-777777' });

    await h.service.run('run-11', h.page, plan, RESULTS_URL);

    // Four opened and saved, one could not be opened — and nothing double-counted.
    expect(h.counters.extractedCount).toBe(4);
    expect(h.counters.failedCount).toBe(1);
    expect(h.counters.extractedCount + h.counters.failedCount).toBe(h.counters.progressCurrent);
  });

  it('accepts a listing whose slug was rewritten but whose id is unchanged', async () => {
    // OLX canonicalises ad URLs; the id is the part that identifies the listing.
    const canonical = 'https://www.olx.com.pk/item/apple-iphone-13-pro-max-iid-1119446833';
    const h = makeHarness({ redirectFrom: QUEUED[2], redirectTo: canonical });

    await h.service.run('run-12', h.page, plan, RESULTS_URL);

    expect(h.upserted).toEqual(QUEUED);
    expect(h.counters.failedCount).toBe(0);
  });
});

describe('PlanExecutorService field extraction', () => {
  const revealPlan: InstructionPlan = {
    steps: [
      { type: 'find_listings' },
      { type: 'click_and_extract', target: 'Show Phone Number button', field: 'contact number' },
    ],
    fieldList: ['contact number'],
    listingLimit: 1,
  };

  it('captures a phone number that only appears a moment after clicking reveal', async () => {
    // Before the click, then two polls still loading, then the number.
    const h = makeHarness({ texts: ['Ad page', 'Ad page', 'Ad page', 'Ad page\n+92-323 7717536'] });

    await h.service.run('run-5', h.page, revealPlan, RESULTS_URL);

    expect(h.rows[0]['contact number']).toBe('03237717536');
  });

  it('drops a phone number the model suggests when it is not actually on the page', async () => {
    const h = makeHarness({ texts: ['Ad page with no number'], aiData: { 'contact number': '0300 9999999' } });

    await h.service.run('run-6', h.page, revealPlan, RESULTS_URL);

    expect(h.rows[0]['contact number']).toBe('');
  });

  it('keeps the "Related ads" strip out of what the model reads', async () => {
    const h = makeHarness({
      texts: ['Apple iPhone 18 Pro Max\nDHA Phase 6, Lahore\nRelated ads\nSamsung S26 Ultra\nGulberg 3, Lahore'],
    });
    const extractPlan: InstructionPlan = {
      steps: [{ type: 'find_listings' }, { type: 'extract', fields: ['title', 'address'] }],
      fieldList: ['title', 'address'],
      listingLimit: 1,
    };

    await h.service.run('run-7', h.page, extractPlan, RESULTS_URL);

    expect(h.aiPageTexts[0]).toContain('DHA Phase 6, Lahore');
    expect(h.aiPageTexts[0]).not.toContain('Gulberg 3');
    expect(h.aiPageTexts[0]).not.toContain('Samsung');
  });
});
