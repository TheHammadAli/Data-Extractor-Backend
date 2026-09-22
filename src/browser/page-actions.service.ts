import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';

const ACTION_TIMEOUT_MS = 8000;

@Injectable()
export class PageActionsService {
  private locatorFor(page: Page, elementIndex: number) {
    return page.locator(`[data-agent-index="${elementIndex}"]`).first();
  }

  async click(page: Page, elementIndex: number): Promise<void> {
    await this.locatorFor(page, elementIndex).click({ timeout: ACTION_TIMEOUT_MS });
  }

  async type(page: Page, elementIndex: number, value: string): Promise<void> {
    const locator = this.locatorFor(page, elementIndex);
    await locator.fill(value, { timeout: ACTION_TIMEOUT_MS });
  }

  async select(page: Page, elementIndex: number, value: string): Promise<void> {
    const locator = this.locatorFor(page, elementIndex);
    try {
      await locator.selectOption({ label: value }, { timeout: ACTION_TIMEOUT_MS });
    } catch {
      // Not a native <select> (custom dropdown/combobox) — fall back to a click to open it.
      await locator.click({ timeout: ACTION_TIMEOUT_MS });
    }
  }

  async scrollToBottom(page: Page): Promise<void> {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  }

  async readVisibleText(page: Page): Promise<string> {
    return page.evaluate(() => document.body?.innerText ?? '');
  }
}
