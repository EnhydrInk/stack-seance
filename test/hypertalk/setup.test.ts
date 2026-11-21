import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as hypertalk from '../../src/hypertalk';

describe('project setup', () => {
  it('imports the interpreter entry point', () => {
    expect(hypertalk).toBeDefined();
  });

  it('runs fast-check properties', () => {
    fc.assert(fc.property(fc.integer(), (n) => n + 0 === n));
  });
});
