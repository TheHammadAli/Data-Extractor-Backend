import { chromium, type Browser, type Page } from 'playwright';
import { MockAiProvider } from '../src/ai/providers/mock-ai.provider.js';
import { CaptchaDetectorService } from '../src/browser/captcha-detector.service.js';
import { ListingCardDetectorService } from '../src/browser/listing-card-detector.service.js';
import { PageActionsService } from '../src/browser/page-actions.service.js';
import { PaginationDetectorService } from '../src/browser/pagination-detector.service.js';
import { SnapshotSerializerService } from '../src/browser/snapshot-serializer.service.js';
import { GroundedActionService } from '../src/execution/grounded-action.service.js';
import { startFixtureServer, server as fixtureServer } from './fixture-site/server.js';

const PORT = 4311;
const BASE_URL = `http://localhost:${PORT}`;

let browser: Browser;
let page: Page;

const ai = new MockAiProvider();
const snapshotSerializer = new SnapshotSerializerService();
const pageActions = new PageActionsService();
const captchaDetector = new CaptchaDetectorService();
const listingCardDetector = new ListingCardDetectorService();
const paginationDetector = new PaginationDetectorService();
const grounded = new GroundedActionService(ai, snapshotSerializer, pageActions);

beforeAll(async () => {
  process.env.FIXTURE_PORT = String(PORT);
  await startFixtureServer(PORT);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
}, 30000);

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => fixtureServer.close(resolve));
});

describe('Browser module against the local fixture site', () => {
  it('detects no CAPTCHA/OTP on a normal page', async () => {
    await page.goto(BASE_URL);
    expect(await captchaDetector.check(page)).toBe('none');
  });

  it('logs in via grounded actions (no hardcoded selectors)', async () => {
    await page.goto(BASE_URL);
    const username = await grounded.groundAndAct(page, 'username or email input field', 'type', 'tester');
    const password = await grounded.groundAndAct(page, 'password input field', 'type', 'secret');
    const submit = await grounded.groundAndAct(page, 'login or sign in submit button', 'click');

    expect(username.success).toBe(true);
    expect(password.success).toBe(true);
    expect(submit.success).toBe(true);

    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('/home');
    expect(await page.locator('#logout-marker').count()).toBeGreaterThan(0);
  });

  it('opens a category and selects a location via grounded actions', async () => {
    await page.goto(`${BASE_URL}/home`);
    const openCategory = await grounded.groundAndAct(page, 'Mobile Phones', 'click');
    expect(openCategory.success).toBe(true);
    await page.waitForLoadState('domcontentloaded');

    const selectLocation = await grounded.groundAndAct(page, 'location selector', 'select', 'Lahore');
    expect(selectLocation.success).toBe(true);
    await grounded.groundAndAct(page, 'Go submit button', 'click');
    await page.waitForLoadState('domcontentloaded');

    expect(page.url()).toContain('location=Lahore');
  });

  it('detects listing cards on the results page', async () => {
    await page.goto(`${BASE_URL}/category/mobile-phones?location=Lahore`);
    const urls = await listingCardDetector.detectListingUrls(page);
    expect(urls.length).toBe(3);
    expect(urls.every((u) => u.includes('/listing/mp-lhr-'))).toBe(true);
  });

  it('detects "Next" pagination and advances to page 2', async () => {
    await page.goto(`${BASE_URL}/category/mobile-phones?location=Lahore`);
    const pagination = await paginationDetector.detect(page);
    expect(pagination.mode).toBe('next');

    await paginationDetector.advance(page, pagination);
    expect(page.url()).toContain('page=2');

    const urls = await listingCardDetector.detectListingUrls(page);
    expect(urls).toEqual([`${BASE_URL}/listing/mp-lhr-4`]);
  });

  it('clicks "Show Phone Number" and reads the revealed value', async () => {
    await page.goto(`${BASE_URL}/listing/mp-lhr-1`);
    const result = await grounded.groundAndAct(page, 'Show Phone Number', 'click');
    expect(result.success).toBe(true);

    await page.waitForTimeout(200);
    const text = await pageActions.readVisibleText(page);
    expect(text).toContain('0300 1234567');
  });

  it('extracts listing detail fields via the mock AI provider', async () => {
    await page.goto(`${BASE_URL}/listing/mp-lhr-2`);
    const pageText = await pageActions.readVisibleText(page);
    const result = await ai.extractListingFields({
      fields: ['title', 'date', 'description', 'seller_name', 'address'],
      pageText,
    });
    expect(result.data.seller_name).toBe('Ali Raza');
    expect(result.data.address).toBe('DHA, Lahore');
  });

  it('returns "" (never invents) when a listing has no phone button', async () => {
    await page.goto(`${BASE_URL}/listing/mp-lhr-4`);
    const result = await grounded.groundAndAct(page, 'Show Phone Number', 'click');
    expect(result.success).toBe(false);
  });
});
