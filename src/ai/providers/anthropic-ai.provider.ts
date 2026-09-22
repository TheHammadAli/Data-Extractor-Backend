import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
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

const DEFAULT_MODEL = 'claude-sonnet-5';

const PLAN_TOOL: Tool = {
  name: 'submit_plan',
  description: 'Submit the parsed execution plan for the user instructions.',
  input_schema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
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
            targetDescription: { type: 'string' },
            value: { type: 'string' },
            fields: { type: 'array', items: { type: 'string' } },
            target: { type: 'string' },
            field: { type: 'string' },
          },
          required: ['type'],
        },
      },
      fieldList: { type: 'array', items: { type: 'string' } },
      listingLimit: { type: 'number' },
    },
    required: ['steps', 'fieldList'],
  },
};

const GROUND_TOOL: Tool = {
  name: 'submit_grounding',
  description: 'Submit which element (if any) matches the requested target.',
  input_schema: {
    type: 'object',
    properties: {
      found: { type: 'boolean' },
      elementIndex: { type: 'number' },
      action: { type: 'string', enum: ['click', 'type', 'select'] },
      valueToType: { type: 'string' },
      confidence: { type: 'number' },
      reasoning: { type: 'string' },
    },
    required: ['found', 'confidence'],
  },
};

const EXTRACT_TOOL: Tool = {
  name: 'submit_extraction',
  description: 'Submit the extracted field values found in the page text.',
  input_schema: {
    type: 'object',
    properties: {
      data: { type: 'object', additionalProperties: { type: 'string' } },
    },
    required: ['data'],
  },
};

/**
 * Real AI provider, implemented against the same AiService interface as MockAiProvider so
 * switching AI_PROVIDER=anthropic requires no changes anywhere else in the app.
 */
@Injectable()
export class AnthropicAiProvider implements AiService {
  private readonly logger = new Logger(AnthropicAiProvider.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    this.model = env.AI_MODEL || DEFAULT_MODEL;
  }

  async parseInstructionsToPlan(instructions: string, targetUrl: string): Promise<InstructionPlan> {
    const input = await this.callTool<InstructionPlan>(PLAN_TOOL, [
      {
        role: 'user',
        content: [
          'Convert these natural-language browser automation instructions into an abstract execution plan.',
          'Do NOT invent CSS selectors or assume a specific website layout — steps must stay abstract descriptions',
          '(e.g. targetDescription: "Mobile Phones category link"), resolved against the live page later.',
          `Target website: ${targetUrl}`,
          `Instructions:\n${instructions}`,
        ].join('\n'),
      },
    ]);
    return {
      steps: input.steps ?? [],
      fieldList: input.fieldList ?? [],
      listingLimit: input.listingLimit,
    };
  }

  async groundElement(request: GroundElementRequest): Promise<GroundElementResult> {
    const elementsDescription = request.elements
      .map((el) => `[${el.index}] role=${el.role} text="${el.text}" attrs=${JSON.stringify(el.attributes ?? {})}`)
      .join('\n');

    const input = await this.callTool<GroundElementResult>(GROUND_TOOL, [
      {
        role: 'user',
        content: [
          `Page context: ${request.pageContext ?? 'unknown'}`,
          `Find the element that best matches: "${request.targetDescription}"`,
          `Intended action: ${request.actionHint}${request.valueToEnter ? ` (value: "${request.valueToEnter}")` : ''}`,
          'Available interactive elements:',
          elementsDescription || '(none found)',
          'If nothing matches with reasonable confidence, set found=false.',
        ].join('\n'),
      },
    ]);
    return input;
  }

  async extractListingFields(request: ExtractFieldsRequest): Promise<ExtractFieldsResult> {
    const input = await this.callTool<ExtractFieldsResult>(EXTRACT_TOOL, [
      {
        role: 'user',
        content: [
          `Extract these fields from the listing page text: ${request.fields.join(', ')}`,
          'If a field is not present on the page, use an empty string for it. Never invent values.',
          `Page text:\n${request.pageText.slice(0, 12000)}`,
        ].join('\n'),
      },
    ]);
    return { data: input.data ?? {} };
  }

  private async callTool<T>(tool: Tool, messages: Anthropic.MessageParam[]): Promise<T> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages,
    });

    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      this.logger.warn(`No tool_use block returned for ${tool.name}`);
      return {} as T;
    }
    return toolUse.input as T;
  }
}
