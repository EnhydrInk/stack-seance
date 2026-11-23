// Runs one script at a time (clicks during a run are ignored, as in HyperCard) and turns
// a failed run into an error notice that knows which script and line it came from.

import { runHandler, type HandlerName, type ScriptError, type Value } from '../hypertalk/index';
import type { BrowserHost } from './host';
import type { Model, ScriptOwner } from './model';
import type { ButtonDoc } from './types';

export class Runner {
  private busy = false;
  /** Shared by every run in the session (R8.2). */
  private readonly globals = new Map<string, Value>();

  constructor(
    private readonly model: Model,
    private readonly host: BrowserHost,
    private readonly onError: (error: ScriptError, owner: ScriptOwner) => void,
    private readonly onBusy: (busy: boolean) => void,
  ) {}

  get running(): boolean {
    return this.busy;
  }

  /** Stops the running script (Esc or ⌘.), as HyperCard's ⌘-period did. */
  stop(): void {
    if (this.busy) this.host.stop();
  }

  click(button: ButtonDoc): Promise<void> {
    return this.run(button.script, 'mouseUp', button.id, button);
  }

  /** Runs the current card's openCard, for moves the interpreter did not make. */
  openCard(): Promise<void> {
    const card = this.model.card;
    return this.run(card.script, 'openCard', card.id, undefined);
  }

  private async run(source: string, handler: HandlerName, scriptId: string, origin: ButtonDoc | undefined): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.onBusy(true);
    this.host.origin = origin;
    this.host.stopped = false;
    try {
      const result = await runHandler(source, handler, { host: this.host, globals: this.globals, scriptId });
      // A script the reader stopped ends quietly, without an error notice.
      if (!result.ok && !this.host.stopped) {
        const owner = this.model.owner(result.error.scriptId ?? scriptId);
        if (owner) this.onError(result.error, owner);
      }
    } finally {
      this.host.origin = undefined;
      this.busy = false;
      this.onBusy(false);
    }
  }
}
