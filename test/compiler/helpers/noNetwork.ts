// No network in compiler and Worker tests (Requirement 14.10). On import, this module
// replaces fetch, XMLHttpRequest and WebSocket with functions that throw an error naming
// the global. Every compiler and Worker test file imports it first. The real Ask gets a
// fake fetch through its options and the Access keys come from a local key set, so a
// test that reaches one of these stubs has found a real network call.
import { vi } from 'vitest';

export const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket'] as const;

/** A plain function, so both `fetch(…)` and `new WebSocket(…)` reach it. */
function blocked(name: string): () => never {
  return function blocked(): never {
    throw new Error(`${name} was called: compiler and Worker tests must not use the network (Requirement 14.10)`);
  };
}

for (const name of NETWORK_GLOBALS) vi.stubGlobal(name, blocked(name));
