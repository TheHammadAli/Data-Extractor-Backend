import type {
  ExtractFieldsRequest,
  ExtractFieldsResult,
  GroundElementRequest,
  GroundElementResult,
  InstructionPlan,
} from './ai.types.js';

/**
 * Provider-agnostic AI abstraction. Nothing outside this module talks to an SDK directly,
 * so swapping providers (Anthropic, OpenAI, ...) never touches business logic.
 */
export interface AiService {
  /** Turn the user's free-text instructions into an ordered, abstract plan. No selectors resolved here. */
  parseInstructionsToPlan(instructions: string, targetUrl: string): Promise<InstructionPlan>;

  /** Ground one abstract step against the page's *current* interactive elements. */
  groundElement(request: GroundElementRequest): Promise<GroundElementResult>;

  /** Extract the requested fields from a listing detail page's visible text. */
  extractListingFields(request: ExtractFieldsRequest): Promise<ExtractFieldsResult>;
}
