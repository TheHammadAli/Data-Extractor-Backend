import { Injectable, Logger } from '@nestjs/common';
import type { AiService } from '../ai.service.interface.js';
import type {
  ExtractFieldsRequest,
  ExtractFieldsResult,
  GroundElementRequest,
  GroundElementResult,
  InstructionPlan,
  PlanStep,
} from '../ai.types.js';
import { similarity } from '../utils/text-similarity.js';
import { canonicalFieldKey, parseFieldList } from './field-synonyms.js';

const ACTION_VERBS = /^(go to|open|log ?in|select|extract|collect|click|add|save|find|search)\b/i;
const MID_SENTENCE_BREAK = /\s+and\s+(collect|click|select|open|log ?in|add|save)\b/gi;
const CLICK_AND_EXTRACT = /click the\s+["“']([^"”']+)["”']\s*(?:button|link)?.*\bextract\b/i;
const FOR_FIELD_PREFIX = /^for the\s+(.+?),/i;

/**
 * Deterministic, no-API-key AI implementation used for local development and fixture testing.
 * Understands the two worked examples from the spec plus similarly-shaped instructions; the real
 * provider (see anthropic-ai.provider.ts) is what actually generalizes to arbitrary phrasing.
 */
@Injectable()
export class MockAiProvider implements AiService {
  private readonly logger = new Logger(MockAiProvider.name);

  async parseInstructionsToPlan(instructions: string, _targetUrl: string): Promise<InstructionPlan> {
    const steps: PlanStep[] = [];
    const fieldSet = new Set<string>();

    const sentences = instructions
      .replace(/\r\n/g, '\n')
      .split(/\n+|(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const sentence of sentences) {
      const clickMatch = sentence.match(CLICK_AND_EXTRACT);
      if (clickMatch) {
        const target = clickMatch[1].trim();
        const forMatch = sentence.match(FOR_FIELD_PREFIX);
        const field = forMatch ? canonicalFieldKey(forMatch[1]) : 'extracted_value';
        steps.push({ type: 'click_and_extract', target, field });
        fieldSet.add(field);
        continue;
      }

      for (const clause of this.splitIntoClauses(sentence)) {
        this.classifyClause(clause, steps, fieldSet);
      }
    }

    if (!steps.some((s) => s.type === 'save_csv')) {
      steps.push({ type: 'save_csv' });
    }

    return { steps, fieldList: Array.from(fieldSet) };
  }

  private splitIntoClauses(sentence: string): string[] {
    const withBreaks = sentence.replace(MID_SENTENCE_BREAK, '|||$1');
    const parts = withBreaks.split('|||');

    const clauses: string[] = [];
    for (const part of parts) {
      const commaSegments = part
        .split(',')
        .map((s) => s.replace(/[.!?]$/, '').trim())
        .filter(Boolean);

      for (const segment of commaSegments) {
        if (ACTION_VERBS.test(segment) || clauses.length === 0) {
          clauses.push(segment);
        } else {
          clauses[clauses.length - 1] += `, ${segment}`;
        }
      }
    }
    return clauses;
  }

  private classifyClause(clause: string, steps: PlanStep[], fieldSet: Set<string>): void {
    if (/^(go to|open) the website$/i.test(clause)) {
      steps.push({ type: 'open_website' });
      return;
    }
    if (/^log ?in( to (my )?account)?$/i.test(clause)) {
      steps.push({ type: 'login' });
      return;
    }
    if (/^open (each|all|every) listing/i.test(clause)) {
      steps.push({ type: 'find_listings' });
      steps.push({ type: 'open_each_listing' });
      return;
    }
    const openMatch = clause.match(/^open\s+(.+)$/i);
    if (openMatch) {
      steps.push({ type: 'open_category', targetDescription: openMatch[1].trim(), value: openMatch[1].trim() });
      return;
    }
    const selectMatch = clause.match(/^select\s+(.+)$/i);
    if (selectMatch) {
      steps.push({ type: 'select_location', targetDescription: selectMatch[1].trim(), value: selectMatch[1].trim() });
      return;
    }
    const extractMatch = clause.match(/^(?:also\s+)?(?:extract|collect)(?:\s+the|\s+all)?\s+(.+)$/i);
    if (extractMatch) {
      const fields = parseFieldList(extractMatch[1]);
      fields.forEach((f) => fieldSet.add(f));
      steps.push({ type: 'extract', fields });
      return;
    }
    if (/^(add|save).*csv/i.test(clause)) {
      steps.push({ type: 'save_csv' });
      return;
    }
    this.logger.debug(`Unrecognized clause, skipping: "${clause}"`);
  }

  async groundElement(request: GroundElementRequest): Promise<GroundElementResult> {
    let bestIndex = -1;
    let bestScore = 0;

    for (const el of request.elements) {
      let score = similarity(el.text, request.targetDescription);
      const attrs = el.attributes ?? {};
      for (const value of Object.values(attrs)) {
        score = Math.max(score, similarity(value, request.targetDescription) * 0.8);
      }
      if (score > bestScore) {
        bestScore = score;
        bestIndex = el.index;
      }
    }

    if (bestIndex === -1 || bestScore < 0.15) {
      return { found: false, confidence: bestScore };
    }

    const action = request.actionHint === 'find' ? 'click' : request.actionHint;
    return {
      found: true,
      elementIndex: bestIndex,
      action,
      valueToType: request.valueToEnter,
      confidence: bestScore,
      reasoning: `token-overlap match (score=${bestScore.toFixed(2)})`,
    };
  }

  async extractListingFields(request: ExtractFieldsRequest): Promise<ExtractFieldsResult> {
    const data: Record<string, string> = {};
    for (const field of request.fields) {
      data[field] = this.extractField(field, request.pageText);
    }
    return { data };
  }

  private extractField(field: string, pageText: string): string {
    const labelPattern = field.replace(/_/g, '[ _-]?');
    const labelled = new RegExp(`${labelPattern}\\s*[:\\-]\\s*(.+)`, 'i');
    const match = pageText.match(labelled);
    if (match) return match[1].trim().split('\n')[0].trim();

    // "title" is usually the unlabelled page heading — the first non-empty line — rather than a
    // "Title: ..." labelled field.
    if (field === 'title') {
      const firstLine = pageText.split('\n').map((l) => l.trim()).find(Boolean);
      if (firstLine) return firstLine;
    }

    return '';
  }
}
