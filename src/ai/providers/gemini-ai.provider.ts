import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiError, GoogleGenAI, Type, type Schema } from '@google/genai';
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

const DEFAULT_MODEL = 'gemini-3.6-flash';
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PLAN_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: {
            type: Type.STRING,
            enum: [
              'open_website',
              'login',
              'open_category',
              'select_location',
              'search',
              'find_listings',
              'open_each_listing',
              'extract',
              'click_and_extract',
              'normalize',
              'save_csv',
            ],
          },
          targetDescription: { type: Type.STRING },
          value: { type: Type.STRING },
          fields: { type: Type.ARRAY, items: { type: Type.STRING } },
          target: { type: Type.STRING },
          field: { type: Type.STRING },
        },
        required: ['type'],
      },
    },
    fieldList: { type: Type.ARRAY, items: { type: Type.STRING } },
    listingLimit: { type: Type.NUMBER },
  },
  required: ['steps', 'fieldList'],
};

const GROUND_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    found: { type: Type.BOOLEAN },
    elementIndex: { type: Type.NUMBER },
    action: { type: Type.STRING, enum: ['click', 'type', 'select'] },
    valueToType: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
  },
  required: ['found', 'confidence'],
};

/**
 * Real AI provider, implemented against the same AiService interface as MockAiProvider so
 * switching AI_PROVIDER=gemini requires no changes anywhere else in the app.
 */
@Injectable()
export class GeminiAiProvider implements AiService {
  private readonly logger = new Logger(GeminiAiProvider.name);
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {
    this.client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
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
      ].join('\n'),
      PLAN_SCHEMA,
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
      ].join('\n'),
      GROUND_SCHEMA,
    );
  }

  async extractListingFields(request: ExtractFieldsRequest): Promise<ExtractFieldsResult> {
    const data = await this.generateJson<Record<string, string>>(
      [
        `Extract these fields from the listing page text: ${request.fields.join(', ')}`,
        'Respond with a flat JSON object whose keys are exactly these field names.',
        'If a field is not present on the page, use an empty string for it. Never invent values.',
        `Page text:\n${request.pageText.slice(0, 12000)}`,
      ].join('\n'),
    );
    return { data: data ?? {} };
  }

  private async generateJson<T>(prompt: string, schema?: Schema): Promise<T> {
    const response = await this.generateContentWithRetry(prompt, schema);

    const text = response.text;
    if (!text) {
      this.logger.warn('Empty response from Gemini');
      return {} as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      this.logger.warn(`Failed to parse Gemini JSON response: ${text.slice(0, 200)}`);
      return {} as T;
    }
  }

  /** Retries transient failures (rate limits, momentary overload) with exponential backoff. */
  private async generateContentWithRetry(prompt: string, schema?: Schema) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.client.models.generateContent({
          model: this.model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            ...(schema ? { responseSchema: schema } : {}),
          },
        });
      } catch (err) {
        lastError = err;
        if (!(err instanceof ApiError) || !RETRYABLE_STATUS_CODES.has(err.status) || attempt === MAX_ATTEMPTS) {
          throw err;
        }
        const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
        this.logger.warn(
          `Gemini request failed (attempt ${attempt}/${MAX_ATTEMPTS}, status=${err.status}). Retrying in ${delay}ms.`,
        );
        await sleep(delay);
      }
    }
    throw lastError;
  }
}
