# Implementation Plan: recompile keeps the label

## Overview

The work follows the request through the compiler: first the contract and `readCompileRequest`, then the User_Message and the System_Prompt, then Rule 7. After a checkpoint come the generators and the property, then the amendments to the sentence-compiler documents. Code changes stay in `src/compiler` and `test/compiler`, plus three edits in `test/worker/handle.test.ts`. Nothing changes in `src/ui`, `src/hypertalk`, `test/hypertalk` or `worker/`, and deployment is not a task.

Every sub-task ends with `npx vitest --run` and `npm run typecheck` passing. Two places need care to keep that true:

- Once `readCompileRequest` reads `label`, the type test, the `REQUEST_LIMITS` test and "drops fields that CompileRequest does not define" in `contract.test.ts` stop passing, so they change in the same sub-task (1.1). "ignores fields that CompileRequest does not define" in `handle.test.ts` sends `label` too, and stops passing once the label reaches the User_Message (2.1), so it changes earlier, in 1.3.
- `retry.test.ts` spells out the Rule 7 sentence in `RULE_7`, so it changes in the same sub-task as `RULES[7]` (3.1).

Requirement numbers (2.4, 5.4) refer to this spec's requirements.md. SC-numbers refer to `.kiro/specs/sentence-compiler/requirements.md`. Section names in quotes ("contract.ts") refer to this spec's design.md.

## Tasks

- [x] 1. The label in the contract and the request check
  - [x] 1.1 Read the label in `src/compiler/contract.ts`
    - `CompileRequest` gains `label?: string;                   // when recompiling: the button's current label, which the reply keeps` after `stackNames`, word for word as in the Contract change section. `CompileResponse` and `CompileOutcome` do not change.
    - `REQUEST_LIMITS` becomes `{ sentence: 500, names: 100, nameLength: 100, label: 24 }`.
    - `readCompileRequest` keeps every check it has, in the same order. Then it returns the seven-field request when the body's `label` is `undefined`, the request with `label` last when `isRequestLabel(label, buttonNames)` holds, and null otherwise, as "contract.ts" gives it. `isRequestLabel` uses `findSameName` from `names.ts` and the `/\S/` blank test, and does not check English.
    - Update the file's top comment, which says the contract types are copied from the sentence-compiler requirements, to name this spec as well.
    - In the same change, so that the suite and the type check stay green, three tests in `test/compiler/contract.test.ts` follow: the type test pins `CompileRequest` with `label?: string` last; the `REQUEST_LIMITS` test expects `label: 24` and checks that `REQUEST_LIMITS.label` equals `ENGLISH_NAME_MAX` from `names.ts`; and "drops fields that CompileRequest does not define" sends `name: 'Hi'` where it sent `label: 'Hi'`, keeping its seven expected keys.
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.5_
  - [x] 1.2 Test the label in `test/compiler/contract.test.ts`
    - New tests, one per case of the design's "Example tests": `label: undefined` gives the seven fields with no `label` key; `Dig` comes back with the keys in contract order then `label`; `挖一挖`, `It's Alive!` and ` Dig` are accepted unchanged; `''`, `'   '`, `'\t'` and `'\u3000\u3000'` give null; `'x'.repeat(24)` and `'👻'.repeat(12)` are accepted while `'x'.repeat(25)` and `'👻'.repeat(13)` give null; `3`, `null`, `true`, `['Dig']` and `{ name: 'Dig' }` give null; with `buttonNames` `['Upstairs', 'Back']`, `'upstairs'`, `'BACK'` and `'Back'` give null.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.1_
  - [x] 1.3 Follow the contract in `test/worker/handle.test.ts`
    - "ignores fields that CompileRequest does not define" sends `name: 'Injected name'` where it sent `label: 'Injected label'`, and checks that the first User_Message does not hold `Injected name`.
    - New "rejects a bad label": `''`, `' \u3000'`, `'l'.repeat(25)`, `3` and `'QUOKKA BUTTON'`, each through the file's `expectBad`, which checks the 400 body, no Model_Call, an unchanged store and the one log line.
    - No file under `worker/` changes.
    - _Requirements: 2.7, 8.5, 8.6_

- [ ] 2. The User_Message and the System_Prompt
  - [x] 2.1 Change `src/compiler/prompt.ts`
    - `userMessage` writes the seven fields in contract order as today, and then `label` only when `label !== undefined`, as "prompt.ts" gives it. Without a label the text is byte for byte today's.
    - Add the `RECOMPILING` constant with the paragraph of "prompt.ts", word for word, and put it in `SYSTEM_PROMPT` after `GUIDANCE` and before `EXAMPLES_SECTION`. `EXAMPLES` does not change.
    - _Requirements: 3.1, 3.2, 4.1, 4.2, 4.3, 4.5_
  - [ ] 2.2 Test them in `test/compiler/prompt.test.ts`
    - The SC6.4 tests: with `{ ...crypt, label: 'Quokka lantern' }`, `SYSTEM_PROMPT` is the same string after `userMessage` runs for it and does not hold `Quokka lantern`.
    - The paragraph: `SYSTEM_PROMPT` holds `\n\n# Recompiling\n\n`, `the reply's label is exactly the request's label`, `button "<the label>"` and `hasButton is false and label is empty`, and `# Recompiling` comes before `# Examples`.
    - `userMessage`: `{ ...hallRequest, label: 'Dig' }` gives the contract keys then `label`, and today's Hall text with `,"label":"Dig"` before the closing brace; a shuffled object with `label` first still gets `label` last; `{ ...hallRequest, label: undefined }` gives today's Hall text exactly.
    - _Requirements: 3.1, 3.2, 4.1, 4.2, 4.3, 4.5, 8.2, 8.4_

- [ ] 3. Rule 7 with a label
  - [ ] 3.1 Change Rule 7 in `src/compiler/rules.ts`, with the sentence in `test/compiler/retry.test.ts`
    - `RULES[7]` becomes `When the request has a label, the label is exactly that label; otherwise it is a short English name of 1 to 24 characters that is not in buttonNames.` The other nine sentences do not change.
    - `labelReports` starts with the Labelled_Request branch of "rules.ts": no report when the reply's label is `===` the Request_Label, and otherwise the one report `The label <quote(label)> is not the label in the request, <quote(request.label)>.`. The Unlabelled_Request code stays as it is.
    - Nothing else in `checkReply` changes: Rule 6 still uses the reply's label, a Nothing_Reply never reaches `labelReports`, and stage 3 still runs before the parse.
    - In the same change, `RULE_7` in `retry.test.ts` becomes `Rule 7: ` plus the new sentence, so the suite stays green.
    - _Requirements: 4.4, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 5.9, 6.1, 6.2_
  - [ ] 3.2 Add `digRequest` and test Rule 7 with a label in `test/compiler/rules.test.ts`
    - `test/compiler/helpers/fixtures.ts`: `digRequest`, the Garden card recompiling Dig, with the names of the design's "Fixture" written out as literals and `label: 'Dig'` last. It does not read `src/ui/stacks.json`.
    - The `RULES` test pins the new Rule 7 sentence word for word.
    - New `describe('Rule 7 with a label in the request')` on `digRequest`, with the cases of the design's "Example tests": `Dig` accepted; `{ ...digRequest, label: '挖一挖' }` with the reply label `挖一挖` accepted; `Dig for seeds`, `dig`, `DIG` and `''` each giving exactly one report `The label "<label>" is not the label in the request, "Dig".`; `hide button "Dig"` and `show button "home"` accepted with label `Dig`; `nothingText()` accepted and `nothingText({ label: 'Dig' })` giving only the Rule 10 report; `summon cat` with label `Dig up` giving the Rule 1 report and then the Kept_Label_Report.
    - The existing Rule 7 tests on `hallRequest` stay as they are.
    - _Requirements: 5.1, 5.3, 5.4, 5.6, 5.7, 5.8, 8.3_
  - [ ] 3.3 Test the retry of a renamed reply in `test/compiler/retry.test.ts`
    - `compile(digRequest, ask)` with a first reply labelled `Dig for seeds` and a second labelled `Dig` gives `ok: true` with label `Dig` after two calls. The second call's messages are `userMessage(digRequest)`, the first reply's turn (the same object), and exactly the Retry_Message of the design's "Example tests".
    - _Requirements: 3.1, 5.4, 5.5_
  - [ ] 3.4 Test a labelled request through the Worker in `test/worker/handle.test.ts`
    - The file's `request` with `label: 'Quokka lamp'`, and a fake reply with that label and the file's `VALID` script and new cards, gives 200 with `label: 'Quokka lamp'`. The first User_Message holds `"label":"Quokka lamp"`, and no log line holds `Quokka`.
    - _Requirements: 2.2, 3.1, 5.1, 8.6_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Correctness properties
  - [ ] 5.1 Extend `test/compiler/helpers/arbitraries.ts`, with two cross-checks in `test/compiler/arbitraries.test.ts`
    - `requestNames` adds the label when the request has one. `LABEL_WORDS`, `labelArb(request)` and `labelledRequestArb`, as the design's "Generators" gives them.
    - `buttonPlanArb`: for a Labelled_Request, the plan's label is `request.label` and only the new cards are drawn fresh. For an Unlabelled_Request the code path is today's, so it builds the same arbitraries and the seeded cross-checks sample the same values.
    - Rule 7 breakers for a Labelled_Request: today's six, each filtered so that its label differs from `request.label`, plus `a fresh English label` and, when `otherCase(request.label) !== request.label`, `the label in other case`. An Unlabelled_Request gets today's six only.
    - `requestArb`, `validReplyArb`, `brokenReplyArb`, `stepsArb` and `newCardCandidateArb` keep their signatures.
    - Cross-checks with `labelledRequestArb`, 1,000 samples each, seeds 23 and 24: every `validReplyArb` reply passes `checkReply` with its own values and every Button_Reply among them has `label === request.label`; every `brokenReplyArb` reply fails with a report for its tagged rule. The two existing cross-checks do not change.
    - _Requirements: 6.3, 9.2, 9.4, 9.5_
  - [ ] 5.2 Write P1 with a label in `test/compiler/safety.property.test.ts`
    - **Property 1 with a label: Safety with a label (P1 safety with a label)**
    - A second `it` in the existing `describe`, next to P1, whose name starts with `P1 safety with a label`, with the comment `Feature: recompile-keeps-label, Property 1: Safety with a label`. 300 runs. The existing P1 `it` does not change.
    - Cases from `labelledRequestArb.chain((request) => stepsArb(request).map((steps) => ({ request, steps })))`. The same checks as P1, through its `expected` and `expectGrowth`: the outcome `toStrictEqual` to the step model, the number of calls, at most three, the same `system` and `schema`, and the messages growing by the same `turn` and a Retry_Message for the tagged rule. Also, when the outcome is `ok: true`, `expect(outcome.label).toBe(request.label)`.
    - **Validates: Requirements 2.2, 3.1, 5.1, 5.3, 5.4, 5.5, 5.6, 5.7, 9.1, 9.2, 9.3, 9.6**

- [ ] 6. Amend the sentence-compiler documents
  - [ ] 6.1 Amend `.kiro/specs/sentence-compiler/requirements.md`
    - The eight amendments of the design's "Amendments to the sentence-compiler spec", word for word: the out-of-scope line of the Introduction, the `label` line in the contract, Request_Names and Request_Label in the glossary, the new SC2.8, SC3.2, SC4.7, SC6.5 and the new SC6.8.
    - Each amended passage names `recompile-keeps-label`. No other passage changes, and existing criteria keep their numbers.
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6_
  - [ ] 6.2 Amend `.kiro/specs/sentence-compiler/design.md`
    - The three amendments of the same section: "contract.ts" (`REQUEST_LIMITS` and the label sentence), "rules.ts" (row 7 of the rules table and of the report details), and "prompt.ts" (the list the prompt is built from, the new section 6, Recompiling, with Examples becoming section 7, and the end of the `userMessage` paragraph).
    - "Correctness Properties", "Testing Strategy", "Decisions", "Notes for deployment" and the sentence-compiler tasks.md do not change.
    - _Requirements: 7.4, 7.5, 7.6_

- [ ] 7. Final checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.
  - Check with `git diff --name-only <commit before task 1>..HEAD` plus `git status` that the changes are only in `src/compiler`, `test/compiler`, `test/worker/handle.test.ts`, `.kiro/specs/sentence-compiler/requirements.md` and `design.md`, this spec's folder, and the hook's entries in `docs/kiro-log.md`. Nothing under `src/ui`, `src/hypertalk`, `test/hypertalk` or `worker/` may change.
  - _Requirements: 6.3, 10.1, 10.2, 10.3, 10.4_

## Notes

- No sub-task is optional. Requirements 8 and 9 make the example tests and the property part of the feature.
- The pre-task hook blocks every task while `vitest` is red, so each sub-task leaves the suite green. Vitest does not type-check, so run `npm run typecheck` before finishing each sub-task too.
- No test uses the network or the real model. Every test file already imports the `noNetwork` helper, and no new test file is added.
- Nothing in `src/compiler` or `test/` reads `src/ui/stacks.json`. `digRequest` copies the Garden card's names as literals.
- The UI's half (sending `label` on Recompile, marking a hand-edited script, asking first) and the Worker's deployment belong to the maintainer. If a task seems to need a change in `src/ui` or `worker/`, or a change to the contract's names or shapes, stop and ask.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["3.1"] },
    { "id": 5, "tasks": ["3.2", "3.4"] },
    { "id": 6, "tasks": ["3.3"] },
    { "id": 7, "tasks": ["4"] },
    { "id": 8, "tasks": ["5.1"] },
    { "id": 9, "tasks": ["5.2"] },
    { "id": 10, "tasks": ["6.1", "6.2"] },
    { "id": 11, "tasks": ["7"] }
  ]
}
```
