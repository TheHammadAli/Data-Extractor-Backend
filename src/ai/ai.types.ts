export type PlanStepType =
  | 'open_website'
  | 'login'
  | 'open_category'
  | 'select_location'
  | 'search'
  | 'find_listings'
  | 'open_each_listing'
  | 'extract'
  | 'click_and_extract'
  | 'normalize'
  | 'save_csv';

export interface PlanStep {
  type: PlanStepType;
  /** Natural-language description of the element to interact with, e.g. "Mobile Phones category link". */
  targetDescription?: string;
  /** Value to select/type, e.g. "Lahore". */
  value?: string;
  /** For `extract` steps: the fields to pull from the current (listing detail) page. */
  fields?: string[];
  /** For `click_and_extract` steps: the button/link text to click, e.g. "Show Phone Number". */
  target?: string;
  /** For `click_and_extract` steps: the output field name to store the revealed value under. */
  field?: string;
}

export interface InstructionPlan {
  steps: PlanStep[];
  /** All fields the CSV should contain, driven entirely by the user's instructions. */
  fieldList: string[];
  /** Optional cap on number of listings to process, if the user specified one. */
  listingLimit?: number;
}

export interface SerializedElement {
  index: number;
  /** e.g. "link", "button", "textbox", "combobox", or a raw ARIA role from the page. */
  role: string;
  text: string;
  attributes?: Record<string, string>;
}

export type GroundActionHint = 'click' | 'type' | 'select' | 'find';

export interface GroundElementRequest {
  targetDescription: string;
  actionHint: GroundActionHint;
  valueToEnter?: string;
  elements: SerializedElement[];
  pageContext?: string;
}

export interface GroundElementResult {
  found: boolean;
  elementIndex?: number;
  action?: 'click' | 'type' | 'select';
  valueToType?: string;
  confidence: number;
  reasoning?: string;
}

export interface ExtractFieldsRequest {
  fields: string[];
  pageText: string;
}

export interface ExtractFieldsResult {
  data: Record<string, string>;
}
