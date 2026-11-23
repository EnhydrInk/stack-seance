// The real Ask: one Model_Call to Claude Opus 5.5 through the official SDK
// (Requirement 7; design.md, "worker/src/ask.ts").
import Anthropic, { APIError, type ClientOptions } from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  BetaMessageContentParam,
  BetaMessageParam,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Ask, ModelInput, ModelReply } from '../../src/compiler/index';

export const MODEL = 'claude-opus-5-5';
export const MAX_TOKENS = 8000;
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
export const DEFAULT_TIMEOUT_MS = 60_000;
/** Set explicitly, so an ANTHROPIC_BASE_URL in the environment or a profile cannot move the call. */
export const API_BASE_URL = 'https://api.anthropic.com';

export interface AskOptions {
  /** The Worker secret ANTHROPIC_API_KEY (7.9). */
  apiKey: string | undefined;
  /** Tests only; production uses the runtime's fetch. */
  fetch?: ClientOptions['fetch'];
  /** Per call; default 60 seconds. The client is made with maxRetries: 0. */
  timeoutMs?: number;
  log(entry: Record<string, unknown>): void;
}

/** The event of the entry a failed SDK call writes. A call that succeeds writes 'model-call'. */
export const FAILURE_EVENT = 'model-call-failed';

/**
 * An Ask that calls the Model. Without a key, every call rejects before any SDK client exists:
 * the SDK is never left to find a key on its own, in the environment or on disk. Otherwise the
 * client is made on the first call. Any API error, network error or timeout rejects (7.10).
 * A rejected SDK call first writes one failure entry, then rejects with the same error.
 */
export function makeAsk(options: AskOptions): Ask {
  let client: Anthropic | undefined;
  return async (input) => {
    if (!options.apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    client ??= new Anthropic({
      apiKey: options.apiKey,
      baseURL: API_BASE_URL,
      maxRetries: 0,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    const body = requestBody(input);
    let response: BetaMessage;
    try {
      response = await client.beta.messages.create(body);
    } catch (error) {
      options.log(failureEntry(error));
      throw error;
    }
    options.log(usageEntry(response));
    return toModelReply(response);
  };
}

/** The request of one call (design.md). Only the schema and messages change between requests. */
export function requestBody(input: ModelInput): MessageCreateParamsNonStreaming {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: input.schema } },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
    messages: input.messages.map(
      (m): BetaMessageParam =>
        m.role === 'user'
          ? { role: 'user', content: m.text }
          // The Assistant_Turn goes back exactly as the API returned it: thinking blocks with
          // their signatures, and a fallback block where there is one (5.3).
          : { role: 'assistant', content: m.turn as BetaMessageContentParam },
    ),
  };
}

/** A Refusal for a final stop_reason of refusal (7.6); otherwise the text and the content as the turn (7.7). */
export function toModelReply(response: BetaMessage): ModelReply {
  if (response.stop_reason === 'refusal') return { kind: 'refusal' };
  const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  return { kind: 'reply', text, turn: response.content };
}

/** What an API error type looks like (authentication_error). Anything else stays out of the log. */
const API_ERROR_TYPE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * The log entry of a failed SDK call: the HTTP status and the API error type when the SDK error
 * has them, and the error's class name. Never the message, which holds the response body, and
 * never the request id, the error code or anything from the request (11.2).
 */
export function failureEntry(error: unknown): Record<string, unknown> {
  const entry: Record<string, unknown> = { event: FAILURE_EVENT };
  if (error instanceof APIError) {
    if (typeof error.status === 'number') entry.status = error.status;
    if (typeof error.type === 'string' && API_ERROR_TYPE.test(error.type)) entry.error_type = error.type;
  }
  // The SDK sets name to each class's own name, which survives a bundler renaming classes.
  entry.error_class = error instanceof Error ? error.name : typeof error;
  return entry;
}

/** Numbers and ids only: never message text. */
function usageEntry(response: BetaMessage): Record<string, unknown> {
  const { usage } = response;
  return {
    event: 'model-call',
    model: response.model,
    stop_reason: response.stop_reason,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
    fallback: usage.iterations?.some((iteration) => iteration.type === 'fallback_message') ?? false,
  };
}
