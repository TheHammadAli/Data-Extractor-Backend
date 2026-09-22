import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import { AI_SERVICE } from '../ai/ai.constants.js';
import type { AiService } from '../ai/ai.service.interface.js';
import type { InstructionPlan, PlanStep } from '../ai/ai.types.js';
import { APP_ENV } from '../config/config.module.js';
import type { AppEnv } from '../config/env.validation.js';
import { CaptchaDetectorService, type CaptchaCheckResult } from '../browser/captcha-detector.service.js';
import { ListingCardDetectorService } from '../browser/listing-card-detector.service.js';
import { PageActionsService } from '../browser/page-actions.service.js';
import { PaginationDetectorService } from '../browser/pagination-detector.service.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { DedupeService } from '../normalization/dedupe.service.js';
import { NormalizationService } from '../normalization/normalization.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RunEventBus } from '../events/run-event-bus.service.js';
import { GroundedActionService } from './grounded-action.service.js';
import { RunControlService } from './run-control.service.js';

const MAX_PAGES = 20;
const REVEAL_POLLS = 10;
const REVEAL_POLL_INTERVAL_MS = 500;
const RELATED_SECTION =
  /^\s*(related ads|similar ads|related listings|similar listings|you may also like|recommended for you|more ads from (this )?seller|people also viewed)\b/im;

@Injectable()
export class PlanExecutorService {
  private readonly logger = new Logger(PlanExecutorService.name);

  constructor(
    @Inject(AI_SERVICE) private readonly ai: AiService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly events: RunEventBus,
    private readonly grounded: GroundedActionService,
    private readonly pageActions: PageActionsService,
    private readonly captchaDetector: CaptchaDetectorService,
    private readonly listingCardDetector: ListingCardDetectorService,
    private readonly paginationDetector: PaginationDetectorService,
    private readonly normalization: NormalizationService,
    private readonly dedupe: DedupeService,
    private readonly credentials: CredentialsService,
    private readonly control: RunControlService,
  ) {}

  async run(runId: string, page: Page, plan: InstructionPlan, targetUrl: string): Promise<void> {
    const listingMarkerIndex = plan.steps.findIndex((s) => s.type === 'find_listings' || s.type === 'open_each_listing');
    const setupSteps = listingMarkerIndex === -1 ? plan.steps : plan.steps.slice(0, listingMarkerIndex);
    const perListingSteps =
      listingMarkerIndex === -1 ? [] : plan.steps.slice(listingMarkerIndex).filter((s) => s.type === 'extract' || s.type === 'click_and_extract');

    for (const step of setupSteps) {
      if (this.control.isCancelled(runId)) return;
      await this.executeSetupStep(runId, page, step, targetUrl);
    }

    if (listingMarkerIndex === -1 || this.control.isCancelled(runId)) return;

    await this.events.emit({ runId, type: 'STEP_START', message: 'Finding listings' });
    const listingLimit = plan.listingLimit ?? this.env.DEFAULT_LISTING_LIMIT;
    await this.runListingLoop(runId, page, perListingSteps, listingLimit);
  }

  private async executeSetupStep(runId: string, page: Page, step: PlanStep, targetUrl: string): Promise<void> {
    switch (step.type) {
      case 'open_website': {
        // A reused standing session may already be sitting on this exact site (the user
        // navigated/logged in there themselves) — re-navigating would reload it and could
        // undo that. Only go there if we're not already on it.
        if (this.originOf(page.url()) !== this.originOf(targetUrl)) {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
        await this.handleChallengeIfPresent(runId, page);
        await this.events.emit({ runId, type: 'CHECKLIST_UPDATE', message: 'Website opened' });
        return;
      }
      case 'login': {
        await this.executeLogin(runId, page);
        return;
      }
      case 'open_category': {
        const target = step.targetDescription ?? step.value ?? '';
        const result = await this.grounded.groundAndAct(page, target, 'click');
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        await this.handleChallengeIfPresent(runId, page);
        if (!result.success) {
          // Carrying on from the wrong page is worse than stopping: the listing detector would
          // harvest whatever repeated links exist here (usually the category menu) and extract
          // nonsense from them.
          await this.pauseForManualStep(
            runId,
            `Could not find "${target}" on this page. Open it yourself in the browser, then click Continue.`,
          );
          return;
        }
        await this.events.emit({ runId, type: 'CHECKLIST_UPDATE', message: `${target} opened` });
        return;
      }
      case 'select_location': {
        const target = step.targetDescription ?? step.value ?? '';
        const urlBeforeSelect = page.url();
        let result = await this.grounded.groundAndAct(page, target, 'select', step.value);
        if (!result.success) {
          result = await this.grounded.groundAndAct(page, target, 'click');
        }

        // Many sites need an explicit submit/apply click after picking a filter value — a plain
        // <select> rarely auto-submits. Only attempt this if the page hasn't already navigated,
        // and treat failure as fine (some sites genuinely do auto-submit on change).
        if (result.success) {
          await page.waitForTimeout(300);
          if (page.url() === urlBeforeSelect) {
            await this.grounded.groundAndAct(page, 'submit, apply, search, or go button', 'click');
            await page.waitForLoadState('domcontentloaded').catch(() => undefined);
          }
        }

        await this.handleChallengeIfPresent(runId, page);
        if (!result.success) {
          await this.pauseForManualStep(
            runId,
            `Could not select "${target}". Set it yourself in the browser, then click Continue.`,
          );
          return;
        }
        await this.events.emit({ runId, type: 'CHECKLIST_UPDATE', message: `${step.value ?? target} selected` });
        return;
      }
      case 'search': {
        const target = step.targetDescription ?? 'search box';
        const result = await this.grounded.groundAndAct(page, target, 'type', step.value);
        if (result.success) await page.keyboard.press('Enter').catch(() => undefined);
        return;
      }
      default:
        return;
    }
  }

  private async executeLogin(runId: string, page: Page): Promise<void> {
    const creds = this.credentials.peek(runId);
    if (!creds) {
      // Pausing for a human to log in only works when that human can see the browser. On a server
      // it would wait forever, so carry on unauthenticated and say so.
      if (this.env.BROWSER_MODE === 'launch') {
        await this.events.emit({
          runId,
          type: 'STEP_FAILED',
          message:
            'No login credentials were provided and this backend runs its own browser, so there is ' +
            'nothing to log into by hand — continuing without an authenticated session.',
        });
        return;
      }
      await this.pauseForManualLogin(runId, page);
      return;
    }

    const usernameResult = await this.grounded.groundAndAct(page, 'username or email input field', 'type', creds.username);
    const passwordResult = await this.grounded.groundAndAct(page, 'password input field', 'type', creds.password);
    const submitResult = await this.grounded.groundAndAct(page, 'login or sign in submit button', 'click');

    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await page.waitForTimeout(1000);
    await this.handleChallengeIfPresent(runId, page);

    this.credentials.wipe(runId);

    const success = usernameResult.success && passwordResult.success && submitResult.success;
    await this.events.emit({
      runId,
      type: success ? 'CHECKLIST_UPDATE' : 'STEP_FAILED',
      message: success ? 'Logged in' : 'Login failed — continuing without an authenticated session',
    });
  }

  private async handleChallengeIfPresent(runId: string, page: Page): Promise<void> {
    const check = await this.captchaDetector.check(page);
    if (check !== 'none') {
      await this.pauseForChallenge(runId, page, check);
    }
  }

  private async pauseForChallenge(runId: string, page: Page, kind: Exclude<CaptchaCheckResult, 'none'>): Promise<void> {
    const status = kind === 'captcha' ? 'PAUSED_CAPTCHA' : 'PAUSED_OTP';
    await this.prisma.run.update({ where: { id: runId }, data: { status } });
    await this.events.emit({
      runId,
      type: 'PAUSE',
      message:
        kind === 'captcha'
          ? 'Human verification required. Complete it in the browser, then click Continue.'
          : 'Please complete the verification code / two-factor prompt, then click Continue.',
      metadata: { status },
    });

    await this.control.waitForResume(runId);
    if (this.control.isCancelled(runId)) return;

    const recheck = await this.captchaDetector.check(page);
    if (recheck !== 'none') {
      await this.pauseForChallenge(runId, page, recheck);
      return;
    }

    await this.prisma.run.update({ where: { id: runId }, data: { status: 'RUNNING' } });
    await this.events.emit({ runId, type: 'RESUMED', message: 'Resumed after manual verification.', metadata: { status: 'RUNNING' } });
  }

  /** Hands control back to the user for one step, then carries on from wherever they left the page. */
  private async pauseForManualStep(runId: string, message: string): Promise<void> {
    await this.events.emit({ runId, type: 'PAUSE', message });
    await this.control.waitForResume(runId);
    if (this.control.isCancelled(runId)) return;
    await this.events.emit({
      runId,
      type: 'RESUMED',
      message: 'Resumed — continuing from the page you left open.',
    });
  }

  /**
   * No credentials were supplied for a `login` step, which means the user intends to log in
   * themselves in the visible browser window rather than have the agent type credentials.
   * Pause and wait for them to finish, exactly like a CAPTCHA/OTP pause.
   */
  private async pauseForManualLogin(runId: string, page: Page): Promise<void> {
    await this.prisma.run.update({ where: { id: runId }, data: { status: 'PAUSED_LOGIN' } });
    await this.events.emit({
      runId,
      type: 'PAUSE',
      message: 'No login credentials were provided. Log in manually in the browser window, then click Continue.',
      metadata: { status: 'PAUSED_LOGIN' },
    });

    await this.control.waitForResume(runId);
    if (this.control.isCancelled(runId)) return;

    await this.handleChallengeIfPresent(runId, page);

    await this.prisma.run.update({ where: { id: runId }, data: { status: 'RUNNING' } });
    await this.events.emit({
      runId,
      type: 'RESUMED',
      message: 'Resumed after manual login.',
      metadata: { status: 'RUNNING' },
    });
  }

  /**
   * The results page is the anchor for the whole job. Listings are only ever opened by their exact
   * queued URL and we always come back here by URL — never via history. Going back through history
   * on a SPA frequently lands somewhere else, and detecting listings from there harvests a detail
   * page's "similar/recommended" links, which is how unrelated listings used to get extracted.
   */
  private async runListingLoop(runId: string, page: Page, perListingSteps: PlanStep[], listingLimit: number): Promise<void> {
    let resultsUrl = page.url();
    const seenUrls = new Set<string>();

    let queue = this.capAndDedupe(await this.listingCardDetector.detectListingUrls(page), seenUrls, listingLimit);

    if (queue.length === 0) {
      // Better to stop and ask than to guess: the detector refuses to treat category or city links
      // as listings, so an empty result usually means we're not on a results page yet.
      await this.pauseForManualStep(
        runId,
        `No listings found on ${resultsUrl}. Open the results page you want in the browser, then click Continue.`,
      );
      if (this.control.isCancelled(runId)) return;
      resultsUrl = page.url();
      queue = this.capAndDedupe(await this.listingCardDetector.detectListingUrls(page), seenUrls, listingLimit);
    }

    await this.updateProgressTotal(runId, seenUrls.size);
    await this.events.emit({ runId, type: 'CHECKLIST_UPDATE', message: `Found ${seenUrls.size} listing(s)` });
    await this.emitQueue(runId, resultsUrl, queue);

    let processedCount = 0;
    let pageCount = 0;

    while (queue.length > 0 && processedCount < listingLimit && pageCount < MAX_PAGES) {
      // The queue is locked while it drains: nothing discovered inside a listing can enter it.
      for (const url of queue) {
        if (processedCount >= listingLimit || this.control.isCancelled(runId)) break;
        await this.processListing(runId, page, url, perListingSteps);
        processedCount += 1;
      }

      if (processedCount >= listingLimit || this.control.isCancelled(runId)) break;

      // Only now, with the queue drained and more listings still wanted, go back to the results
      // page (by URL) and extend the queue from the next page of results.
      await this.gotoIfNeeded(page, resultsUrl);
      pageCount += 1;
      const beforeSize = seenUrls.size;
      const pagination = await this.paginationDetector.detect(page);
      await this.paginationDetector.advance(page, pagination).catch(() => undefined);
      await page.waitForTimeout(600);
      await this.handleChallengeIfPresent(runId, page);
      resultsUrl = page.url();

      queue = this.capAndDedupe(
        await this.listingCardDetector.detectListingUrls(page),
        seenUrls,
        listingLimit - processedCount,
      );
      if (seenUrls.size === beforeSize) break;
      await this.updateProgressTotal(runId, seenUrls.size);
      await this.emitQueue(runId, resultsUrl, queue);
    }
  }

  private async emitQueue(runId: string, resultsUrl: string, queue: string[]): Promise<void> {
    if (queue.length === 0) return;
    await this.events.emit({
      runId,
      type: 'LOG',
      message: [
        `Listing queue locked (${queue.length}) from ${resultsUrl}:`,
        ...queue.map((url, i) => `  ${i + 1}. ${url}`),
      ].join('\n'),
    });
  }

  /** Same page ignoring a trailing slash — enough to tell "still here" from "somewhere else". */
  private isSamePage(actual: string, expected: string): boolean {
    const normalize = (value: string): string => {
      try {
        const parsed = new URL(value);
        return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`;
      } catch {
        return value;
      }
    };
    return normalize(actual) === normalize(expected);
  }

  private async gotoIfNeeded(page: Page, url: string): Promise<void> {
    if (this.isSamePage(page.url(), url)) return;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
  }

  /**
   * Opens exactly the queued URL and confirms we landed on it. A redirect (to a login wall, a
   * different ad, an interstitial) must never be mistaken for the queued listing.
   */
  private async openQueuedListing(runId: string, page: Page, url: string): Promise<boolean> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const navigated = await page
        .goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
        .then(() => true)
        .catch(() => false);

      if (navigated && this.isSamePage(page.url(), url)) return true;

      if (navigated) {
        await this.events.emit({
          runId,
          type: 'LOG',
          message: `Landed on ${page.url()} instead of the queued listing — re-opening the exact URL.`,
        });
      }
    }

    await this.events.emit({ runId, type: 'STEP_FAILED', message: `Could not open queued listing: ${url}` });
    await this.bumpCounters(runId, { failed: true });
    return false;
  }

  /** Lines present after a click that weren't present before — the mechanical "what got revealed". */
  private diffRevealedText(before: string, after: string): string {
    const beforeLines = new Set(
      before.split('\n').map((l) => l.trim()).filter(Boolean),
    );
    const newLines = after
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !beforeLines.has(l));
    return newLines.join(' ').trim();
  }

  /**
   * Just the listing itself. Detail pages end with a "Related ads" strip carrying other ads' titles,
   * prices and addresses, which the model would otherwise happily pick fields from.
   */
  private mainListingText(text: string): string {
    const match = RELATED_SECTION.exec(text);
    return match ? text.slice(0, match.index) : text;
  }

  /**
   * Clicks the reveal control and waits for what it reveals. The number is usually fetched after the
   * click, so a single fixed wait read the page too early; poll until something that is actually a
   * valid value for this field shows up.
   */
  private async revealField(page: Page, target: string, field: string): Promise<string> {
    const before = await this.pageActions.readVisibleText(page);
    const click = await this.grounded.groundAndAct(page, target, 'click');
    if (!click.success) return '';

    let after = before;
    for (let attempt = 0; attempt < REVEAL_POLLS; attempt += 1) {
      await page.waitForTimeout(REVEAL_POLL_INTERVAL_MS);
      after = await this.pageActions.readVisibleText(page);
      const revealed = this.diffRevealedText(before, after);
      if (revealed && this.normalization.normalizeField(field, revealed)) return revealed;
    }

    // Nothing valid appeared as new lines (the site may have replaced text in place). Let the model
    // look — but only keep its answer if it is really on the page, so a number is never invented.
    const pageText = this.mainListingText(after);
    const extraction = await this.ai.extractListingFields({ fields: [field], pageText });
    const value = extraction.data[field] ?? '';
    return value && this.appearsOnPage(value, field, pageText) ? value : '';
  }

  private appearsOnPage(value: string, field: string, pageText: string): boolean {
    const pageDigits = pageText.replace(/\D/g, '');
    const normalized = this.normalization.normalizeField(field, value);
    for (const candidate of [value.replace(/\D/g, ''), normalized.replace(/\D/g, '')]) {
      if (candidate.length >= 7 && pageDigits.includes(candidate)) return true;
    }
    const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    return squash(pageText).includes(squash(value));
  }

  private originOf(url: string): string | null {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }

  private capAndDedupe(urls: string[], seen: Set<string>, remaining: number): string[] {
    const fresh: string[] = [];
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      fresh.push(url);
      if (fresh.length >= Math.max(remaining, 0)) break;
    }
    return fresh;
  }

  private async updateProgressTotal(runId: string, total: number): Promise<void> {
    await this.prisma.run.update({ where: { id: runId }, data: { progressTotal: total } });
  }

  private async processListing(runId: string, page: Page, url: string, perListingSteps: PlanStep[]): Promise<void> {
    if (!(await this.openQueuedListing(runId, page, url))) return;

    await this.handleChallengeIfPresent(runId, page);

    // Missing-field status is decided from the FINAL merged `data`, not per-step: an `extract`
    // step legitimately finds contact_number empty before the reveal button is clicked, but a
    // later click_and_extract step fills it in — checking per-step would flag that as failed
    // even though the listing ends up complete.
    const data: Record<string, string> = {};

    for (const step of perListingSteps) {
      if (step.type === 'extract' && step.fields?.length) {
        const pageText = this.mainListingText(await this.pageActions.readVisibleText(page));
        const result = await this.ai.extractListingFields({ fields: step.fields, pageText });
        Object.assign(data, result.data);
      } else if (step.type === 'click_and_extract' && step.target && step.field) {
        data[step.field] = await this.revealField(page, step.target, step.field);
        await this.events.emit({
          runId,
          type: 'LOG',
          message: data[step.field]
            ? `${step.field} revealed after clicking "${step.target}"`
            : `${step.field}: nothing was revealed after clicking "${step.target}" — left empty`,
        });
      }
    }

    let anyFieldMissing = Object.values(data).some((v) => !v);
    const normalized = this.normalization.normalizeAll(data);
    const dedupeKey = this.dedupe.computeKey({
      listingUrl: url,
      title: normalized.title,
      seller: normalized.seller_name,
      price: normalized.price,
      address: normalized.address,
    });

    try {
      await this.prisma.extractedListing.upsert({
        where: { runId_dedupeKey: { runId, dedupeKey } },
        create: { runId, listingUrl: url, dedupeKey, data: normalized },
        update: { data: normalized },
      });
      await this.events.emit({ runId, type: 'LOG', message: `Extracted listing: ${normalized.title || url}` });
    } catch (err) {
      this.logger.warn(`Failed to persist listing ${url}: ${err}`);
      anyFieldMissing = true;
    }

    await this.bumpCounters(runId, { failed: anyFieldMissing });
  }

  private async bumpCounters(runId: string, opts: { failed: boolean }): Promise<void> {
    const run = await this.prisma.run.update({
      where: { id: runId },
      data: {
        extractedCount: { increment: 1 },
        failedCount: opts.failed ? { increment: 1 } : undefined,
        progressCurrent: { increment: 1 },
      },
    });
    await this.events.emit({
      runId,
      type: 'COUNTER_UPDATE',
      message: `Progress ${run.progressCurrent}/${run.progressTotal}`,
      metadata: { extractedCount: run.extractedCount, failedCount: run.failedCount, progressCurrent: run.progressCurrent, progressTotal: run.progressTotal },
    });
  }
}
