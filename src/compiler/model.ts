// The boundary between the compiler and any model (design.md, "model.ts"). The compiler
// reaches the Model only through an Ask it is given (Requirement 12.1): the Worker passes
// one that calls the API, and tests pass a fake.

/** A Result_Rule, 1 to 10 (Requirement 4). rules.ts re-exports it with the rule sentences. */
export type RuleNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type Message =
  | { role: 'user'; text: string }
  | { role: 'assistant'; turn: unknown };   // the Assistant_Turn, opaque to the compiler

export interface ModelInput {
  system: string;                            // SYSTEM_PROMPT
  schema: Readonly<Record<string, unknown>>; // REPLY_SCHEMA
  messages: readonly Message[];
}

export type ModelReply =
  | { kind: 'reply'; text: string; turn: unknown }
  | { kind: 'refusal' };

/** One Model_Call. It rejects when the call fails (Requirement 5.6, 7.10). */
export type Ask = (input: ModelInput) => Promise<ModelReply>;

/** What happened on one Model_Call, with rule numbers only and no reply text, so it can be logged. */
export type CallEvent = { call: 1 | 2 | 3 } & (
  | { result: 'accepted' } | { result: 'broken'; rules: RuleNumber[] }
  | { result: 'refusal' } | { result: 'failed' });
