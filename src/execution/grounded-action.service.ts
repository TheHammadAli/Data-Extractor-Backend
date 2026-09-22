import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import { AI_SERVICE } from '../ai/ai.constants.js';
import type { AiService } from '../ai/ai.service.interface.js';
import type { GroundActionHint } from '../ai/ai.types.js';
import { PageActionsService } from '../browser/page-actions.service.js';
import { SnapshotSerializerService } from '../browser/snapshot-serializer.service.js';

const CONFIDENCE_THRESHOLD = 0.15;
const MAX_ATTEMPTS = 2;

export interface GroundAndActResult {
  success: boolean;
  confidence?: number;
  reasoning?: string;
}

/**
 * Resolves one abstract "do X" instruction against the page's *current* DOM and performs it.
 * Never caches a snapshot/selector across calls — every attempt re-captures the live page,
 * per the spec's "inspect the actual webpage" requirement.
 */
@Injectable()
export class GroundedActionService {
  private readonly logger = new Logger(GroundedActionService.name);

  constructor(
    @Inject(AI_SERVICE) private readonly ai: AiService,
    private readonly snapshotSerializer: SnapshotSerializerService,
    private readonly pageActions: PageActionsService,
  ) {}

  async groundAndAct(
    page: Page,
    targetDescription: string,
    actionHint: GroundActionHint,
    valueToEnter?: string,
  ): Promise<GroundAndActResult> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const elements = await this.snapshotSerializer.capture(page);
      const grounding = await this.ai.groundElement({
        targetDescription,
        actionHint,
        valueToEnter,
        elements,
        pageContext: `${page.url()} — ${await page.title().catch(() => '')}`,
      });

      if (!grounding.found || grounding.elementIndex === undefined || grounding.confidence < CONFIDENCE_THRESHOLD) {
        this.logger.debug(`Grounding attempt ${attempt} failed for "${targetDescription}" (confidence=${grounding.confidence})`);
        continue;
      }

      try {
        const action = grounding.action ?? (actionHint === 'find' ? 'click' : actionHint);
        if (action === 'type') {
          await this.pageActions.type(page, grounding.elementIndex, grounding.valueToType ?? valueToEnter ?? '');
        } else if (action === 'select') {
          await this.pageActions.select(page, grounding.elementIndex, grounding.valueToType ?? valueToEnter ?? '');
        } else {
          await this.pageActions.click(page, grounding.elementIndex);
        }
        return { success: true, confidence: grounding.confidence, reasoning: grounding.reasoning };
      } catch (err) {
        this.logger.debug(`Action execution failed on attempt ${attempt} for "${targetDescription}": ${err}`);
      }
    }
    return { success: false };
  }
}
