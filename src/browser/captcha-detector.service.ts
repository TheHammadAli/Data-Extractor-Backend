import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';

export type CaptchaCheckResult = 'none' | 'captcha' | 'otp';

const CAPTCHA_FRAME_SELECTOR = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="turnstile"]',
  'iframe[src*="captcha"]',
].join(', ');

const OTP_INPUT_SELECTOR = [
  'input[autocomplete="one-time-code"]',
  'input[name*="otp"]',
  'input[name*="one-time"]',
  'input[id*="otp"]',
].join(', ');

const CAPTCHA_TEXT_PATTERNS = [
  /verify you are human/i,
  /i'?m not a robot/i,
  /prove you'?re not a robot/i,
  /checking your browser/i,
  /unusual traffic from your computer/i,
];
const OTP_TEXT_PATTERNS = [/one[- ]time (password|code)/i, /verification code/i, /enter the code/i, /two-factor/i];

/**
 * The height cutoff is what separates a real challenge (the reCAPTCHA v2 / hCaptcha checkbox is
 * 78px tall) from the ever-present reCAPTCHA v3 badge (60px).
 */
const MIN_CHALLENGE_WIDTH = 200;
const MIN_CHALLENGE_HEIGHT = 70;

interface PageProbe {
  challengeVisible: boolean;
  otpInputVisible: boolean;
  text: string;
}

/**
 * A challenge only counts when it is *visibly blocking the user*. Many sites embed an invisible
 * reCAPTCHA v3 badge on every page, so merely finding a captcha iframe (or the word "captcha" in
 * the page text) means nothing — detecting on that alone paused every single page of a normal run.
 *
 * Biased towards under-detection on purpose: a missed challenge just means the next step fails and
 * the user steps in, whereas a false positive stops a working run dead.
 *
 * There is deliberately no code path that attempts to solve or bypass either kind of challenge —
 * the only outcome of a positive detection is pausing for a human.
 */
@Injectable()
export class CaptchaDetectorService {
  async check(page: Page): Promise<CaptchaCheckResult> {
    const probe = await this.probePage(page);
    if (!probe) return 'none';

    if (probe.challengeVisible) return 'captcha';
    if (CAPTCHA_TEXT_PATTERNS.some((p) => p.test(probe.text))) return 'captcha';

    // Wording alone is not enough — "verification code" shows up in help text and listing bodies.
    // Only an actual field to type a code into means the user is being prompted for one.
    if (probe.otpInputVisible && OTP_TEXT_PATTERNS.some((p) => p.test(probe.text))) return 'otp';

    return 'none';
  }

  private async probePage(page: Page): Promise<PageProbe | null> {
    const args = {
      frameSelector: CAPTCHA_FRAME_SELECTOR,
      otpSelector: OTP_INPUT_SELECTOR,
      minWidth: MIN_CHALLENGE_WIDTH,
      minHeight: MIN_CHALLENGE_HEIGHT,
    };

    try {
      return await page.evaluate(function probe(input: typeof args): PageProbe {
        function rectOf(el: Element): DOMRect {
          return el.getBoundingClientRect();
        }
        function isVisible(el: Element): boolean {
          const rect = rectOf(el);
          return rect.width > 0 && rect.height > 0;
        }

        const frames: Element[] = Array.prototype.slice.call(
          document.querySelectorAll(input.frameSelector),
        );
        const challengeVisible = frames.some(function isChallenge(el: Element): boolean {
          const rect = rectOf(el);
          return rect.width >= input.minWidth && rect.height >= input.minHeight;
        });

        const otpInputs: Element[] = Array.prototype.slice.call(
          document.querySelectorAll(input.otpSelector),
        );

        return {
          challengeVisible,
          otpInputVisible: otpInputs.some(isVisible),
          text: document.body ? document.body.innerText : '',
        };
      }, args);
    } catch {
      return null;
    }
  }
}
