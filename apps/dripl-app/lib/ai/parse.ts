import { MAX_MODEL_RESPONSE_LENGTH } from './constants';
import { isRecord } from './coerce';

export class AiResponseError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502
  ) {
    super(message);
    this.name = 'AiResponseError';
  }
}

export function extractBalancedArray(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  // Scan once. The previous implementation restarted at every unmatched '[',
  // which made a response containing many opening brackets quadratic.
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '[') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === ']' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

export function parseJsonCandidate(candidate: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (Array.isArray(parsed)) return parsed;
    if (isRecord(parsed) && Array.isArray(parsed.elements)) return parsed.elements;
  } catch {
    // Try the next candidate. Model prose and Markdown fences are common.
  }
  return null;
}

export function parseModelElements(text: string): unknown[] {
  if (text.length > MAX_MODEL_RESPONSE_LENGTH) {
    throw new AiResponseError('AI_RESPONSE_ERROR', 'The AI response was too large to process.');
  }

  const candidates: string[] = [text.trim()];
  const fencedPattern = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  for (const match of text.matchAll(fencedPattern)) {
    const fenced = match[1]?.trim();
    if (fenced) candidates.push(fenced);
  }
  const balancedArray = extractBalancedArray(text);
  if (balancedArray) candidates.push(balancedArray);

  for (const candidate of candidates) {
    const parsed = parseJsonCandidate(candidate);
    if (parsed) return parsed;
  }

  throw new AiResponseError('AI_RESPONSE_ERROR', 'The AI returned an unusable diagram.');
}

export function responseText(result: unknown): string {
  if (!isRecord(result) || !isRecord(result.response)) {
    throw new AiResponseError('AI_RESPONSE_ERROR', 'The AI returned an empty response.');
  }

  const response = result.response;
  const feedback = isRecord(response.promptFeedback) ? response.promptFeedback : undefined;
  const blockReason = feedback?.blockReason;
  if (typeof blockReason === 'string' && blockReason !== 'BLOCKED_REASON_UNSPECIFIED') {
    throw new AiResponseError(
      'CONTENT_BLOCKED',
      'The AI could not generate a diagram for that prompt.',
      422
    );
  }

  const candidate = Array.isArray(response.candidates) ? response.candidates[0] : undefined;
  const finishReason = isRecord(candidate) ? candidate.finishReason : undefined;
  if (
    typeof finishReason === 'string' &&
    !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(finishReason)
  ) {
    const code = finishReason === 'MAX_TOKENS' ? 'AI_INCOMPLETE' : 'CONTENT_BLOCKED';
    const message =
      finishReason === 'MAX_TOKENS'
        ? 'The AI response is incomplete. Try a shorter or simpler prompt.'
        : 'The AI could not generate a diagram for that prompt.';
    throw new AiResponseError(code, message, finishReason === 'MAX_TOKENS' ? 502 : 422);
  }

  const textMethod = response.text;
  let text: unknown;
  try {
    text =
      typeof textMethod === 'function' ? (textMethod as () => unknown).call(response) : textMethod;
  } catch {
    throw new AiResponseError('AI_RESPONSE_ERROR', 'The AI returned an empty response.');
  }

  if (typeof text !== 'string' || text.trim() === '') {
    throw new AiResponseError('AI_RESPONSE_ERROR', 'The AI returned an empty response.');
  }
  return text;
}
