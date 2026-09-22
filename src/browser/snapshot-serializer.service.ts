import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import type { SerializedElement } from '../ai/ai.types.js';

const MAX_ELEMENTS = 150;
const INTERACTIVE_SELECTOR =
  'a[href], button, [role="button"], input, textarea, select, [role="combobox"], [role="textbox"], [role="checkbox"], [role="radio"], [onclick]';

/**
 * Captures a compact, tagged list of the page's *currently visible* interactive elements —
 * never a full screenshot or raw HTML dump, to keep AI grounding calls cheap. Each candidate
 * element is tagged with `data-agent-index` so a later PageActionsService call can locate it
 * precisely without guessing a CSS selector.
 */
@Injectable()
export class SnapshotSerializerService {
  async capture(page: Page): Promise<SerializedElement[]> {
    return page.evaluate(
      ({ selector, maxElements }) => {
        function roleOf(el: Element): string {
          const roleAttr = el.getAttribute('role');
          if (roleAttr) return roleAttr;
          const tag = el.tagName.toLowerCase();
          if (tag === 'a') return 'link';
          if (tag === 'button') return 'button';
          if (tag === 'select') return 'combobox';
          if (tag === 'textarea') return 'textbox';
          if (tag === 'input') {
            const type = (el as HTMLInputElement).type;
            if (type === 'checkbox') return 'checkbox';
            if (type === 'radio') return 'radio';
            if (type === 'submit' || type === 'button') return 'button';
            return 'textbox';
          }
          return 'other';
        }

        const candidates = Array.from(document.querySelectorAll(selector));
        const results: Array<{ index: number; role: string; text: string; attributes: Record<string, string> }> = [];
        let idx = 0;

        for (const el of candidates) {
          if (idx >= maxElements) break;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el as HTMLElement);
          const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          if (!visible) continue;

          el.setAttribute('data-agent-index', String(idx));
          const text = (
            (el as HTMLElement).innerText ||
            (el as HTMLInputElement).value ||
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            ''
          )
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 200);

          results.push({
            index: idx,
            role: roleOf(el),
            text,
            attributes: {
              id: el.id || '',
              href: el.getAttribute('href') || '',
              name: el.getAttribute('name') || '',
              type: el.getAttribute('type') || '',
              testId: el.getAttribute('data-testid') || '',
            },
          });
          idx += 1;
        }
        return results;
      },
      { selector: INTERACTIVE_SELECTOR, maxElements: MAX_ELEMENTS },
    );
  }
}
