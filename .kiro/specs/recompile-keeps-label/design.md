# Design Document: recompile keeps the label

## Overview

A CompileRequest can now carry `label`, the current label of the button being recompiled. `readCompileRequest` checks it, `userMessage` sends it to the model, the System_Prompt explains it in one static paragraph, and Rule 7 requires the reply to keep it exactly. Everything else in the compiler, and all of the Worker's code, stays as it is. A request without a label goes through every step exactly as before.

Requirement numbers ("Requirement 5.4") refer to this spec's requirements.md. SC-numbers (SC2.7, SC4.7) refer to `.kiro/specs/sentence-compiler/requirements.md`. Section names in quotes ("rules.ts") refer to this document unless they say otherwise.

| Path | Change |
|---|---|
| `src/compiler/contract.ts` | `label?: string` in `CompileRequest`; `REQUEST_LIMITS.label = 24`; `readCompileRequest` reads the label |
| `src/compiler/prompt.ts` | `userMessage` adds `label` last when there is one; a new static section `# Recompiling` in `SYSTEM_PROMPT` |
| `src/compiler/rules.ts` | the new `RULES[7]` sentence; `labelReports` checks a Request_Label by exact match |
| `src/compiler/compile.ts`, `index.ts`, `model.ts`, `names.ts`, `references.ts`, `schema.ts` | no change |
| `worker/` | no change: `handle.ts` passes the result of `readCompileRequest` to `compile` |
| `test/compiler/helpers/fixtures.ts` | `digRequest`, the Labelled_Request of the walkthrough below |
| `test/compiler/helpers/arbitraries.ts` | `labelArb`, `labelledRequestArb`; `requestNames` and `buttonPlanArb` use the label; Rule 7 breakers for a Labelled_Request |
| `test/compiler/contract.test.ts`, `prompt.test.ts`, `rules.test.ts`, `retry.test.ts` | the example tests of Requirement 8 |
| `test/compiler/safety.property.test.ts`, `arbitraries.test.ts` | P1 safety with a label, and two cross-checks |
| `test/worker/handle.test.ts` | the unknown-field test uses another field name; bad labels give 400; one labelled 200 |
| `.kiro/specs/sentence-compiler/requirements.md`, `design.md` | the amendments in "Amendments to the sentence-compiler spec" |

## A recompile, step by step

The person flips the Garden card, edits Dig's sentence and presses Recompile. The UI sends the card's other buttons in `buttonNames` and Dig's current label in `label`:

```json
{
  "sentence": "A Dig button: say \"You found a pumpkin seed!\" with Keep it or Plant it, then write \"You picked: \" and the choice in msg.",
  "stackName": "Haunted House",
  "cardNames": ["Gate", "Hall", "Attic", "Garden"],
  "cardName": "Garden",
  "fieldNames": ["msg"],
  "buttonNames": ["Look at the moon", "Previous card", "Start over", "Home"],
  "stackNames": ["Home", "Haunted House", "Help"],
  "label": "Dig"
}
```

1. `readCompileRequest` accepts it: `"Dig"` is 3 code units, not Blank, and not the Same_Name as any of the four other buttons. The result holds `label` last.
2. `userMessage` writes the seven fields as today, then `"label":"Dig"`.
3. Suppose the first reply has `"label": "Dig for seeds"`. Rule 7 gives the Kept_Label_Report `The label "Dig for seeds" is not the label in the request, "Dig".`, and the Retry_Message carries it with the Rule 7 sentence.
4. The second reply has `"label": "Dig"` and follows every rule, so `compile` returns `ok: true` with `label: "Dig"`. The card script's `hide button "Dig"` and Look at the moon's `show button "Dig"` still find the button.

## Components and Interfaces

### contract.ts

```ts
export interface CompileRequest {
  sentence: string;                 // 1..500 characters
  stackName: string;                // the current stack
  cardNames: string[];              // every card of the current stack, in order
  cardName: string;                 // the card the button goes on
  fieldNames: string[];             // fields on that card
  buttonNames: string[];            // other buttons on that card
  stackNames: string[];             // every stack, for go to stack
  label?: string;                   // when recompiling: the button's current label, which the reply keeps
}

/** Lengths in UTF-16 code units (the JavaScript `length`), list sizes in entries. */
export const REQUEST_LIMITS = { sentence: 500, names: 100, nameLength: 100, label: 24 } as const;
```

`CompileResponse` and `CompileOutcome` do not change.

`readCompileRequest` does every check it does today, in the same order, and builds the seven-field request as today. Then:

```ts
  const request: CompileRequest = { sentence, stackName, cardNames, cardName, fieldNames, buttonNames, stackNames };
  // A request without a label is read exactly as before (recompile-keeps-label, Requirement 2.1).
  const { label } = body;
  if (label === undefined) return request;
  return isRequestLabel(label, buttonNames) ? { ...request, label } : null;
```

```ts
/**
 * A Request_Label: a string of 1 to 24 code units that is not blank and is not the Same_Name as
 * another button on the card. It is not checked for English: it comes from an earlier reply or
 * from a built-in button (recompile-keeps-label, Requirement 2).
 */
function isRequestLabel(value: unknown, buttonNames: readonly string[]): value is string {
  return typeof value === 'string'
    && value.length >= 1 && value.length <= REQUEST_LIMITS.label
    && /\S/.test(value)
    && findSameName(buttonNames, value) === undefined;
}
```

- `findSameName` comes from `names.ts`, which imports nothing, so `contract.ts` can import it without a cycle. It skips empty entries, and a label is never empty here.
- `/\S/` is the Sentence's blank test, so a label of U+3000 full-width spaces is Blank too.
- `label === undefined` covers a missing field. JSON cannot carry `undefined`, so only a JavaScript caller can pass one, and it gets the Unlabelled_Request it asked for. `null` is not `undefined`, so `label: null` is a bad request.
- The result holds `label` after `stackNames`, so `Object.keys` of the result follows the contract order.

### prompt.ts

`userMessage`:

```ts
export function userMessage(req: CompileRequest): string {
  const { sentence, stackName, cardNames, cardName, fieldNames, buttonNames, stackNames, label } = req;
  const fields = { sentence, stackName, cardNames, cardName, fieldNames, buttonNames, stackNames };
  return `Compile this request:\n${JSON.stringify(label === undefined ? fields : { ...fields, label })}`;
}
```

Without a label the text is byte for byte what it is today. That keeps the examples in the System_Prompt, `HALL_USER_MESSAGE` in `retry.test.ts`, and every P1 message check unchanged.

The System_Prompt gains one constant section, placed after the guidance and before the examples, so that it reads as the exception to the guidance that labels are English:

```ts
const RECOMPILING = `# Recompiling

A request can hold one more field, label. Then the button already exists, its sentence was edited, and it is being recompiled. The button keeps that label, because other scripts may name it: the reply's label is exactly the request's label, with the same characters and the same case, even when it is not a short English name. A script that names this button writes button "<the label>". When nothing in the sentence can be done, hasButton is false and label is empty, as for every request.`;

export const SYSTEM_PROMPT: string = [TASK, REPLY, SUBSET, RULES_SECTION, GUIDANCE, RECOMPILING, EXAMPLES_SECTION].join('\n\n');
```

The paragraph takes no argument and holds no name from any request, so the System_Prompt stays one text (Requirement 4.3). It does not use the words that the existing test of SC6.7 forbids (`reasoning`, `step by step`, `explain`, `think`). The rules section is still built from `RULES`, so it picks up the new Rule 7 sentence with no change in `prompt.ts`. `EXAMPLES` does not change.

### rules.ts

The new Rule 7 sentence:

| Rule | Sentence in `RULES` |
|---|---|
| 7 | When the request has a label, the label is exactly that label; otherwise it is a short English name of 1 to 24 characters that is not in buttonNames. |

The other nine sentences do not change. `labelReports` gains one branch at its start:

```ts
function labelReports(request: CompileRequest, label: string): RuleReport[] {
  // A recompiled button keeps its label: only the same code units pass (recompile-keeps-label, Requirement 5).
  if (request.label !== undefined) {
    if (label === request.label) return [];
    return [{ rule: 7, detail: `The label ${quote(label)} is not the label in the request, ${quote(request.label)}.` }];
  }
  // ...today's code, unchanged
}
```

| Rule | Detail (exact text; `q` is `quote`) |
|---|---|
| 7, Labelled_Request | `The label <q(label)> is not the label in the request, <q(request.label)>.` |
| 7, Unlabelled_Request | unchanged: `The label <q(label)> <problems>.` |

Nothing else in `checkReply` changes:

- Stage 3 calls `labelReports` before the parse, so a Rule 1 break still reports Rule 7 (Requirement 5.8).
- Rule 6 still looks the button names up in `[...request.buttonNames, reply.label]` (Requirement 5.6). When the reply keeps the label, that is the Request_Label. When it does not, Rule 7 already reports it, and a `button "<Request_Label>"` in the script gets a Rule 6 report too. Both go back to the model, and both go away once the label is right.
- A Nothing_Reply never reaches `labelReports`. Stage 2 checks it as today, and Rule 10 requires `label` to be empty (Requirement 5.7).

`checkReply` does not check the Request_Label against `buttonNames` again. `compile` gets its requests from `readCompileRequest` in the Worker, or from test fixtures.

### compile.ts and the Worker

`compile` passes the whole request to `userMessage` and `checkReply`, so the label reaches both with no change. The Retry_Loop, the three-call limit and the append-only messages are as they are (Requirement 5.5).

`worker/src/handle.ts` calls `readCompileRequest` and answers 400 when it returns null, before the limit check and before any Model_Call (SC2.7, SC8.3). A bad label therefore costs nothing. The Worker's log lines hold only the status, the error and the CallEvents, so the label never reaches the log (SC11.2).

## Error Handling

The request:

| `label` in the body | `readCompileRequest` | Worker |
|---|---|---|
| missing | the seven fields, as today | as today |
| `"Dig"`, `"挖一挖"`, `"It's Alive!"`, `" Dig"`, `"x".repeat(24)`, `"👻".repeat(12)` | the request with that label, unchanged | counted, then `compile` |
| `""`, `"   "`, `"\t"`, `"\u3000\u3000"` | null | 400 `bad-request`, not counted, no Model_Call |
| `"x".repeat(25)`, `"👻".repeat(13)` (26 code units) | null | 400 |
| `3`, `null`, `true`, `["Dig"]`, `{ "name": "Dig" }` | null | 400 |
| `"dig"` when `buttonNames` holds `"Dig"` | null | 400 |

A reply to a Labelled_Request whose Request_Label is `"Dig"`:

| Reply | Result of the check | Outcome |
|---|---|---|
| `hasButton: true`, label `"Dig"`, every other rule kept | accepted | `ok: true`, label `"Dig"` |
| label `"Dig for seeds"`, `"dig"`, `"DIG"` or `""` | the Kept_Label_Report | the next Model_Call, or `model` after the third |
| label `"Dig"` and `hide button "Dig"` in the script | accepted (Rule 6 finds the label) | `ok: true` |
| `hasButton: false`, label `""`, one skipped phrase | accepted | `nothing` |
| `hasButton: false`, label `"Dig"` | Rule 10: `hasButton is false, but label is not empty.` | the next Model_Call, or `model` after the third |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system: a formal statement about what the system should do. Properties are the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1 with a label: Safety with a label (P1 safety with a label)

*For any* Labelled_Request from `labelledRequestArb`, and *for any* sequence of 3 to 5 fake steps from `stepsArb(request)` (replies built to follow the rules for that request, replies built to break one named rule, among them unparsable text, wrong JSON shapes, a fresh English label and the Request_Label in other case, Refusals, and rejected calls), `compile` with a fake `ask` that plays the steps in order:

- returns exactly the outcome that the model of the steps in the Compiler_Spec's Property 1 gives (walk the first three steps; a rejected call or a Refusal gives `model`; a reply built to follow the rules gives its outcome; a broken reply moves on; three broken replies give `model`), compared with `toStrictEqual`;
- when the outcome is `ok: true`, has `outcome.label` equal to `request.label` with `toBe`. This check reads the request, not the steps, so a generator bug and a checker bug that agree still fail it;
- makes exactly as many calls as the walk used, never more than three, with the same `system` and `schema` on every call. Each call's messages are the previous call's, then the previous step's `turn` (the same object) and a Retry_Message holding `Rule <n>:` for that step's rule. The first message is `userMessage(request)`, which holds the label.

The expected outcome comes from how the generator built each step, not from `checkReply` (Requirement 9.3). It runs 300 times, like P1.

**Validates: Requirements 2.2, 3.1, 5.1, 5.3, 5.4, 5.5, 5.6, 5.7, 9.1, 9.2, 9.3, 9.6**

### The existing properties

P1, P2 and P3 keep their code and run on Unlabelled_Requests from `requestArb`, which does not change (Requirement 6.3). The generators take the new branches only when `request.label` is set, so for an Unlabelled_Request they build the same arbitraries as today. The two seeded cross-checks (seeds 21 and 22) therefore sample the same values. P2 and P3 get no labelled variant: P1 with a label already compares the whole outcome with the built reply, and new cards do not depend on the label.

## Testing Strategy

Every test file stays under the `noNetwork` import. No new test file is added, so `scan.test.ts` needs no change.

### Fixture

`test/compiler/helpers/fixtures.ts` gains `digRequest`: the request of "A recompile, step by step", written out as literals like the other fixtures (stack `Haunted House`, cards `Gate`, `Hall`, `Attic`, `Garden`, card `Garden`, field `msg`, buttons `Look at the moon`, `Previous card`, `Start over`, `Home`, stacks `Home`, `Haunted House`, `Help`, label `Dig`). It does not read `src/ui/stacks.json`. `VALID_BUTTON` passes the rules for it once its label is `Dig`.

### Generators (`test/compiler/helpers/arbitraries.ts`)

- `requestNames(request)` adds the label when the request has one. For an Unlabelled_Request it returns the same list as today.
- `LABEL_WORDS`: `Dig`, `Look at the moon`, `Start over`, `It's Alive!` (labels of built-in buttons), `挖一挖` (not an English_Name), and `Open the creaky old door` (24 code units). None holds a double quote or a line break, so a valid script can name the button (R11.7). None is a breaker constant of Rule 7 (`去厨房`, `お化け`, `Say "boo"`, `Open the very creaky door`, `Go to the kitchen and let a bat out`).
- `labelArb(request)`: a fresh English name from `freshArb(requestNames(request))`, as an earlier reply would give, or one of `LABEL_WORDS`, filtered to differ ignoring case from every name in `request.buttonNames` (Requirement 9.4).
- `labelledRequestArb`: `requestArb.chain((r) => labelArb(r).map((label) => ({ ...r, label })))`, so `label` is the last field.
- `buttonPlanArb(request)`: for a Labelled_Request, the plan's label is `request.label`, and it draws only the new cards with `freshNamesArb(requestNames(request), cards)`. For an Unlabelled_Request it runs today's code. The naming statements can name the label button in both cases, as today.
- Rule 7 breakers for a Labelled_Request: today's six, each filtered so that the label it writes differs from `request.label`, plus `a fresh English label` (`freshArb(takenNames(request, plan))`, the rename a first grow would give) and, when `otherCase(request.label) !== request.label`, `the label in other case`. An Unlabelled_Request gets today's six only, because a fresh English label is valid for it.
- The other breakers do not change. Those that use the label (Rule 8's label button after a go) or fresh names (Rules 3 to 6) work as they are, because `takenNames` includes the label.

### Generator cross-checks (`test/compiler/arbitraries.test.ts`)

Two more tests, like the two that exist, with `labelledRequestArb`, 1,000 samples each, seeds 23 and 24:

- Every `validReplyArb` reply passes `checkReply` with its own values, and every Button_Reply among them has `label === request.label`.
- Every `brokenReplyArb` reply fails `checkReply` with a report for its tagged rule.

### Example tests

- `test/compiler/contract.test.ts`
  - The type test pins `CompileRequest` with `label?: string` last. `REQUEST_LIMITS` is `{ sentence: 500, names: 100, nameLength: 100, label: 24 }`, and `REQUEST_LIMITS.label` equals `ENGLISH_NAME_MAX`, because a label an earlier reply gave must fit.
  - No label: the existing tests stay. One new check: `{ ...request(), label: undefined }` gives the seven fields and no `label` key.
  - A good label: `Dig` comes back unchanged, and `Object.keys` are the seven fields then `label`.
  - Not English: `挖一挖`, `It's Alive!` and ` Dig` are accepted unchanged.
  - Empty and Blank: `''`, `'   '`, `'\t'` and `'\u3000\u3000'` give null.
  - Length: `'x'.repeat(24)` and `'👻'.repeat(12)` are accepted; `'x'.repeat(25)` and `'👻'.repeat(13)` give null.
  - Not a string: `3`, `null`, `true`, `['Dig']` and `{ name: 'Dig' }` give null.
  - Already a button: with `buttonNames` `['Upstairs', 'Back']`, the labels `'upstairs'`, `'BACK'` and `'Back'` give null.
  - "drops fields that CompileRequest does not define" uses `name: 'Hi'` where it used `label: 'Hi'`, and keeps its seven expected keys (Requirement 8.5).
- `test/compiler/prompt.test.ts`
  - The SC6.4 tests: a Labelled_Request `{ ...crypt, label: 'Quokka lantern' }`. `SYSTEM_PROMPT` is the same string after `userMessage` runs for it, and does not hold `Quokka lantern`.
  - The paragraph: `SYSTEM_PROMPT` holds `\n\n# Recompiling\n\n`, `the reply's label is exactly the request's label`, `button "<the label>"` and `hasButton is false and label is empty`, and the section sits before `# Examples`.
  - `userMessage`: for `{ ...hallRequest, label: 'Dig' }` the keys are the contract order then `label`, and the text is today's Hall message with `,"label":"Dig"` before the closing brace. A shuffled object with `label` first still gets it last. `{ ...hallRequest, label: undefined }` gives today's Hall text exactly.
  - The existing test that every `RULES` sentence is in the prompt covers the new Rule 7 sentence.
- `test/compiler/rules.test.ts`, a new `describe('Rule 7 with a label in the request')` on `digRequest`:
  - `label: 'Dig'` is accepted. `{ ...digRequest, label: '挖一挖' }` with the reply label `挖一挖` is accepted, though today's Rule 7 would reject it.
  - `Dig for seeds`, `dig`, `DIG` and `''` each give exactly `[r(7, 'The label "<label>" is not the label in the request, "Dig".')]`.
  - `mouseUp('hide button "Dig"', 'show button "home"')` with label `Dig` is accepted (Rule 6).
  - `nothingText()` is accepted. `nothingText({ label: 'Dig' })` gives only `r(10, 'hasButton is false, but label is not empty.')`.
  - `mouseUp('summon cat')` with label `Dig up` gives the Rule 1 report and the Kept_Label_Report, in that order.
  - The existing Rule 7 tests on `hallRequest` stay as they are. A new `RULES` check pins the Rule 7 sentence word for word.
- `test/compiler/retry.test.ts`
  - `RULE_7` becomes `Rule 7: ` plus the new sentence.
  - New: `compile(digRequest, ask)` with a first reply labelled `Dig for seeds` and a second labelled `Dig`. The outcome is `ok: true` with label `Dig`, after two calls. The second call's messages are `userMessage(digRequest)`, the first reply's turn (the same object), and exactly this Retry_Message:

    ```
    Your reply broke these rules.

    Rule 7: When the request has a label, the label is exactly that label; otherwise it is a short English name of 1 to 24 characters that is not in buttonNames.
    - The label "Dig for seeds" is not the label in the request, "Dig".

    Write the whole reply again as one JSON object that follows every rule.
    ```
- `test/worker/handle.test.ts`
  - "ignores fields that CompileRequest does not define" sends `name: 'Injected name'` where it sent `label: 'Injected label'`, and checks that the User_Message does not hold `Injected name` (Requirement 8.5).
  - New "rejects a bad label": `''`, `' \u3000'`, `'l'.repeat(25)`, `3` and `'QUOKKA BUTTON'` (the Same_Name as the request's `Quokka button`), each through `expectBad`, which checks the 400 body, no Model_Call, an unchanged store and the one log line.
  - New: the request with `label: 'Quokka lamp'` and a reply with that label gives 200 with `label: 'Quokka lamp'`. The first User_Message holds `"label":"Quokka lamp"`, and no log line holds `Quokka`.

### Property tests

| Property | File | Runs |
|---|---|---|
| P1 safety with a label | `test/compiler/safety.property.test.ts`, a second `it` next to P1 that reuses its `expected` and `expectGrowth` | 300 |

The test name starts with `P1 safety with a label`, with the comment `Feature: recompile-keeps-label, Property 1: Safety with a label`. The suite takes about 3 seconds today, and the new property and cross-checks add about a second, well inside the 180-second limit of the pre-task hook.

## Amendments to the sentence-compiler spec

Only the passages that describe the contract and the rules change (Requirement 7). Each names this spec.

`.kiro/specs/sentence-compiler/requirements.md`:

1. Introduction, the out-of-scope line. It becomes: "Out of scope: the UI, deployment and secrets (the API key is created separately and the maintainer deploys), and changing the interpreter. Recompiling when a sentence is edited calls the same endpoint again with the button's current label, which the reply keeps (spec `recompile-keeps-label`)."
2. Contract: the line `label?: string;                   // when recompiling: the button's current label, which the reply keeps` after `stackNames`.
3. Glossary: **Request_Names** ends with "and the Request_Label, when the request has one". A new entry: "**Request_Label**: the `label` of a CompileRequest that has one, the current label of a button being recompiled (spec `recompile-keeps-label`)."
4. New SC2.8: "THE Worker SHALL treat a request that has a `label` as a bad request unless the label is a string of 1 to 24 characters, counted as in 2.3, that holds a character that is not whitespace and is not the Same_Name as any name in `buttonNames`. The label is not checked for being English. A request without a `label` is checked as the criteria above say (spec `recompile-keeps-label`)."
5. SC3.2 gains: "WHEN the request has a Request_Label, THE Compiler SHALL return that label, unchanged, whatever its language (Rule 7; spec `recompile-keeps-label`)."
6. SC4.7 becomes: "Rule 7: WHEN the request has no Request_Label, THE Rule_Checker SHALL accept a Button_Reply only when the label is 1 to 24 characters long and is not the Same_Name as any name in `buttonNames`; also, the label is an English_Name, which is how the code checks "English". WHEN the request has a Request_Label, THE Rule_Checker SHALL accept a Button_Reply only when the label is exactly the Request_Label, with the same characters in the same case (spec `recompile-keeps-label`)."
7. SC6.5 gains: "It SHALL hold the Request_Label only when the request has one, after the other fields (spec `recompile-keeps-label`)."
8. New SC6.8: "THE System_Prompt SHALL hold a static paragraph saying that when the request has a label, the button is being recompiled and keeps that label, so the reply's label is exactly that label and the script names the button by it (spec `recompile-keeps-label`)."

`.kiro/specs/sentence-compiler/design.md`:

1. "contract.ts": `REQUEST_LIMITS` with `label: 24`, and a sentence after the `readCompileRequest` paragraph: "A `label` is read only when the body has one. It must be a string of 1 to 24 code units that `/\S/` matches and that is not the Same_Name as a name in `buttonNames`, and it comes back last, after `stackNames` (spec `recompile-keeps-label`)."
2. "rules.ts": row 7 of the rules table with the new sentence, and row 7 of the report details gains "with a Request_Label: `The label <q(label)> is not the label in the request, <q(request label)>.` (spec `recompile-keeps-label`)".
3. "prompt.ts": the list of what `SYSTEM_PROMPT` is built from gains the recompiling paragraph. A new section 6, **Recompiling**, between Guidance and Examples, which become section 7, summarizes the paragraph. The `userMessage` paragraph ends "…the seven fields in contract order, and then `label` when the request has one (spec `recompile-keeps-label`)."

The Compiler_Spec's tasks.md, "Correctness Properties", "Testing Strategy", "Decisions" and "Notes for deployment" do not change (Requirement 7.6).

## Decisions

- **The Rule 7 sentence changes, and stays the one source.** The request asks for the rule texts in the prompt and the checker to stay the same sentences, with `rules.ts` as the single source. Rule 7 itself changes, so its sentence states both cases. Keeping the old sentence would send a retry for the label `挖一挖` with "the label is a short English name" above the report, which pulls the model away from the label it must keep.
- **The label is checked once, in `readCompileRequest`.** `checkReply` compares the reply's label with the Request_Label and nothing else. Repeating the `buttonNames` check there would put a request check in the reply checker.
- **No English check on the Request_Label, as the request says.** A Request_Label comes from an earlier reply, which was an English_Name, or from a built-in button. A label with a double quote would be accepted and kept, though no script could name it (R11.7). The UI does not send one.
- **`REQUEST_LIMITS.label` is 24, next to the other request limits.** It equals `ENGLISH_NAME_MAX`, so every label a reply gave fits. `src/ui/compile.ts` keeps its own copy of the contract and imports nothing from `src/compiler`, so the new key changes nothing there.
- **No recompile example in `EXAMPLES`.** The request asks for a short paragraph, and the examples stay those of SC6.2. If the model often misses the label in practice, an example is the next step. The Worker's per-call log shows Rule 7 retries by rule number.
- **The prompt cache is written once more after deploy.** The System_Prompt text changes (the Rule 7 sentence and the paragraph), but it is still one text for every request.
- **P1 with a label lives next to P1.** It reuses P1's model of the steps and its message checks, which are not exported, and leaves the existing `it` unchanged.
