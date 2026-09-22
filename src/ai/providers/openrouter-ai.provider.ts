import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI, { APIError } from 'openai';
import { APP_ENV } from '../../config/config.module.js';
import type { AppEnv } from '../../config/env.validation.js';
import type { AiService } from '../ai.service.interface.js';
import type {
  ExtractFieldsRequest,
  ExtractFieldsResult,
  GroundElementRequest,
  GroundElementResult,
  InstructionPlan,
} from '../ai.types.js';

const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PLAN_SCHEMA_DESCRIPTION = `{
  "steps": [{
    "type": "open_website" | "login" | "open_category" | "select_location" | "search" | "find_listings" | "open_each_listing" | "extract" | "click_and_extract" | "normalize" | "save_csv",
    "targetDescription"?: string,
    "value"?: string,
    "fields"?: string[],
    "target"?: string,
    "field"?: string
  }],
  "fieldList": string[],
  "listingLimit"?: number
}`;

const GROUND_SCHEMA_DESCRIPTION = `{
  "found": boolean,
  "elementIndex"?: number,
  "action"?: "click" | "type" | "select",
  "valueToType"?: string,
  "confidence": number,
  "reasoning"?: string
}`;

/**
 * Real AI provider, implemented against the same AiService interface as MockAiProvider so
 * switching AI_PROVIDER=openrouter requires no changes anywhere else in the app.
 * OpenRouter proxies many underlying models behind an OpenAI-compatible API, and tool-calling
 * support varies model to model, so — unlike the Anthropic/Gemini providers — this asks for
 * plain JSON via a described shape in the prompt rather than a forced tool call or strict schema.
 */
@Injectable()
export class OpenRouterAiProvider implements AiService {
  private readonly logger = new Logger(OpenRouterAiProvider.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {
    this.client = new OpenAI({ apiKey: env.OPENROUTER_API_KEY, baseURL: OPENROUTER_BASE_URL });
    this.model = env.AI_MODEL || DEFAULT_MODEL;
  }

  async parseInstructionsToPlan(instructions: string, targetUrl: string): Promise<InstructionPlan> {
    const result = await this.generateJson<InstructionPlan>(
      [
        'Convert these natural-language browser automation instructions into an abstract execution plan.',
        'Do NOT invent CSS selectors or assume a specific website layout — steps must stay abstract descriptions',
        '(e.g. targetDescription: "Mobile Phones category link"), resolved against the live page later.',
        `Target website: ${targetUrl}`,
        `Instructions:\n${instructions}`,
        `Respond with ONLY a JSON object matching this shape:\n${PLAN_SCHEMA_DESCRIPTION}`,
      ].join('\n'),
    );
    return {
      steps: result.steps ?? [],
      fieldList: result.fieldList ?? [],
      listingLimit: result.listingLimit,
    };
  }

  async groundElement(request: GroundElementRequest): Promise<GroundElementResult> {
    const elementsDescription = request.elements
      .map((el) => `[${el.index}] role=${el.role} text="${el.text}" attrs=${JSON.stringify(el.attributes ?? {})}`)
      .join('\n');

    return this.generateJson<GroundElementResult>(
      [
        `Page context: ${request.pageContext ?? 'unknown'}`,
        `Find the element that best matches: "${request.targetDescription}"`,
        `Intended action: ${request.actionHint}${request.valueToEnter ? ` (value: "${request.valueToEnter}")` : ''}`,
        'Available interactive elements:',
        elementsDescription || '(none found)',
        'If nothing matches with reasonable confidence, set found=false.',
        `Respond with ONLY a JSON object matching this shape:\n${GROUND_SCHEMA_DESCRIPTION}`,
      ].join('\n'),
    );
  }

  async extractListingFields(request: ExtractFieldsRequest): Promise<ExtractFieldsResult> {
    const data = await this.generateJson<Record<string, string>>(
      [
        `Extract these fields from the listing page text: ${request.fields.join(', ')}`,
        'Respond with ONLY a flat JSON object whose keys are exactly these field names.',
        'If a field is not present on the page, use an empty string for it. Never invent values.',
        `Page text:\n${request.pageText.slice(0, 12000)}`,
      ].join('\n'),
    );
    return { data: data ?? {} };
  }

  private async generateJson<T>(prompt: string): Promise<T> {
    const response = await this.createChatCompletionWithRetry(prompt);
    const text = response.choices[0]?.message?.content;
    if (!text) {
      this.logger.warn('Empty response from OpenRouter');
      return {} as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      this.logger.warn(`Failed to parse OpenRouter JSON response: ${text.slice(0, 200)}`);
      return {} as T;
    }
  }

  /** Retries transient failures (rate limits, momentary overload) with exponential backoff. */
  private async createChatCompletionWithRetry(prompt: string) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.client.chat.completions.create({
          model: this.model,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        });
      } catch (err) {
        lastError = err;
        const status = err instanceof APIError ? err.status : undefined;
        if (!status || !RETRYABLE_STATUS_CODES.has(status) || attempt === MAX_ATTEMPTS) {
          throw err;
        }
        const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
        this.logger.warn(
          `OpenRouter request failed (attempt ${attempt}/${MAX_ATTEMPTS}, status=${status}). Retrying in ${delay}ms.`,
        );
        await sleep(delay);
      }
    }
    throw lastError;
  }
}
