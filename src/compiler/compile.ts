// The Retry_Loop (Requirement 5; design.md, "compile.ts"). It uses no clock and no
// randomness: the same request and the same replies always give the same calls and outcome.

import type { CompileOutcome, CompileRequest } from './contract';
import type { Ask, CallEvent, Message, ModelReply } from './model';
import { retryMessage, SYSTEM_PROMPT, userMessage } from './prompt';
import { checkReply } from './rules';
import { REPLY_SCHEMA } from './schema';

export const MAX_MODEL_CALLS = 3;

/**
 * Compiles one request through `ask`, with at most three Model_Calls. `onCall` receives one
 * CallEvent per call, with rule numbers only and no reply text, so it can be logged.
 */
export async function compile(request: CompileRequest, ask: Ask, onCall?: (event: CallEvent) => void): Promise<CompileOutcome> {
  // Messages are only ever appended, so the prompt cache and the model's earlier thinking stay valid (5.8).
  const messages: Message[] = [{ role: 'user', text: userMessage(request) }];

  for (let n = 1; n <= MAX_MODEL_CALLS; n++) {
    const call = n as CallEvent['call'];
    let reply: ModelReply;
    try {
      // Each call gets its own copy of the list, so a fake model can keep every input it saw.
      reply = await ask({ system: SYSTEM_PROMPT, schema: REPLY_SCHEMA, messages: [...messages] });
    } catch {
      onCall?.({ call, result: 'failed' });
      return { ok: false, error: 'model' };
    }
    if (reply.kind === 'refusal') {
      onCall?.({ call, result: 'refusal' });
      return { ok: false, error: 'model' };
    }

    const checked = checkReply(request, reply.text);
    if (checked.ok) {
      onCall?.({ call, result: 'accepted' });
      const accepted = checked.reply;
      if (accepted.kind === 'nothing') return { ok: false, error: 'nothing', skipped: accepted.skipped };
      const { label, script, newCards, skipped } = accepted;
      return { ok: true, label, script, newCards, skipped };
    }

    onCall?.({ call, result: 'broken', rules: [...new Set(checked.reports.map((r) => r.rule))] });
    // After a broken third reply there is no next call (5.4).
    if (n === MAX_MODEL_CALLS) break;
    messages.push({ role: 'assistant', turn: reply.turn }, { role: 'user', text: retryMessage(checked.reports) });
  }
  return { ok: false, error: 'model' };
}
