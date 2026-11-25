# Requirements Document

## Introduction

When a person edits the sentence on the back of a card and presses Recompile, the UI sends the edited sentence to `POST /api/compile`, and the compiler picks a new label. The button is renamed. Scripts elsewhere that name it then point at a button that no longer exists. On the Garden card of the built-in Haunted House, the card script runs `hide button "Dig"` and the Look at the moon button runs `show button "Dig"`. If Dig is recompiled and comes back labelled "Dig for seeds", both lines name a button the card no longer has.

This spec adds one optional field to CompileRequest, `label`. The UI sends it only on Recompile, and its value is the button's current label. When a request has a label, the reply keeps exactly that label, and the compiler tells the model to name the button by it in the script. A request without a label behaves exactly as today.

The change is in the compiler in `src/compiler`, its tests, and the documents of the sentence-compiler spec where they describe the contract and the rules. The Worker's code does not change: it reads every request through `readCompileRequest`, so the label check comes with it. Two existing tests send `label` as an example of a field the contract does not define, one of them in `test/worker/handle.test.ts`, and they change with the contract (Requirement 8.5).

Out of scope: any change in `src/ui` (sending the label on Recompile, marking a hand-edited script, asking before a recompile; the maintainer does these), renaming buttons by hand, keeping labels on the first grow, and deployment (the maintainer deploys the Worker).

## Contract change (fixed)

The UI is written against this now. The field's name and shape are fixed, and changing them needs the maintainer's agreement first.

```ts
interface CompileRequest {
  sentence: string;
  stackName: string;
  cardNames: string[];
  cardName: string;
  fieldNames: string[];
  buttonNames: string[];            // other buttons on that card
  stackNames: string[];
  label?: string;                   // when recompiling: the button's current label, which the reply keeps
}
```

CompileResponse does not change.

## Glossary

- **Compiler_Spec**: the spec in `.kiro/specs/sentence-compiler/` (requirements.md and design.md). SC-numbers such as SC2.7 and SC4.7 refer to its requirements. Terms that this document does not define (Compiler, Worker, Rule_Checker, Result_Rules, Button_Reply, Nothing_Reply, Model_Call, Model_Reply, Retry_Loop, Retry_Message, User_Message, System_Prompt, Same_Name, English_Name, Test_Suite) mean what the Compiler_Spec says they mean.
- **Request_Label**: the `label` of a CompileRequest that has one.
- **Labelled_Request**: a CompileRequest with a Request_Label. The UI sends one on Recompile.
- **Unlabelled_Request**: a CompileRequest without a `label`. The UI sends one on the first grow, and sent only these before this change.
- **Length**: the number of UTF-16 code units of a string (the JavaScript `length`), as for the other request limits (SC2.3, SC2.4).
- **Blank**: a string with no character that `/\S/` matches, as for the Sentence (SC2.3). The empty string, spaces, tabs and U+3000 full-width spaces are Blank.
- **RULES**: the table of rule sentences in `src/compiler/rules.ts`. It is the single source of the rule sentences in the System_Prompt and in the Retry_Message.
- **Kept_Label_Report**: the Rule 7 report for a reply to a Labelled_Request whose label is not the Request_Label (Requirement 5.4).
- **Change_Set**: every file this spec adds or modifies.

## Requirements

### Requirement 1: The label in the contract

**User Story:** As the developer of the UI, I want the request to carry the button's current label on Recompile, so that I can write the Recompile call now against a fixed shape.

#### Acceptance Criteria

1. THE Compiler SHALL export `CompileRequest` with the fields of the Contract change section: the seven fields of today, with unchanged names and types, followed by `label?: string`.
2. THE Compiler SHALL keep `CompileResponse` and `CompileOutcome` unchanged.
3. THE contract type test in `test/compiler/contract.test.ts` SHALL pin `CompileRequest` with the optional `label`, and SHALL keep pinning `CompileResponse` and `CompileOutcome` as today.

### Requirement 2: Reading the label

**User Story:** As the operator, I want a bad label turned away like any other bad request, so that it never reaches the model or the daily count.

#### Acceptance Criteria

1. WHEN a request body has no `label` field, or its `label` is `undefined` (which JSON cannot carry), THE `readCompileRequest` function SHALL accept or reject the body exactly as today, and an accepted request SHALL hold the seven fields of today and no `label` field.
2. WHEN a request body has a `label` that is a string of Length 1 to 24, is not Blank, and is not the Same_Name as any name in `buttonNames`, THE `readCompileRequest` function SHALL return the request with that label, unchanged, as its last field after `stackNames`.
3. IF a request body has a `label` that is not a string, such as a number, `null`, a boolean, an array or an object, THEN `readCompileRequest` SHALL return null.
4. IF a request body has a `label` that is Blank or longer than 24, THEN `readCompileRequest` SHALL return null.
5. IF a request body has a `label` that is the Same_Name as a name in `buttonNames`, THEN `readCompileRequest` SHALL return null.
6. THE `readCompileRequest` function SHALL NOT check whether the label is an English_Name or ASCII text, because a Request_Label comes from an earlier reply or from a built-in button.
7. WHEN `readCompileRequest` returns null because of the label, THE Worker SHALL answer 400 `{ ok: false, error: 'bad-request' }` without counting the request and without a Model_Call (SC2.7), with no change to the Worker's code.

### Requirement 3: The User_Message

**User Story:** As the developer, I want the model to see the label only when there is one, so that a first grow sends exactly what it sends today.

#### Acceptance Criteria

1. WHEN the request is a Labelled_Request, THE User_Message SHALL hold the Request_Label as the field `label` of its JSON, after the seven other fields in contract order.
2. WHEN the request is an Unlabelled_Request, THE User_Message SHALL be the same text as today, with no `label` field.

### Requirement 4: The System_Prompt

**User Story:** As the developer, I want the model told once, in the cached prompt, what a label in the request means, so that it keeps the label on the first try.

#### Acceptance Criteria

1. THE System_Prompt SHALL hold a short static paragraph that says that when the request has a label, the button is being recompiled and keeps that label, so the reply's label is exactly that label and the script names the button by it.
2. THE paragraph SHALL also say that when nothing in the sentence can be done, the reply has `hasButton` false and an empty label, as for every request.
3. THE System_Prompt SHALL be the same text for every CompileRequest, Labelled or Unlabelled, and SHALL hold no Request_Label of the request being compiled (SC6.4), so that the prompt cache holds.
4. THE System_Prompt SHALL state each rule with its sentence from RULES, so that the rule sentences in the System_Prompt and in the Retry_Message stay the same sentences.
5. THE paragraph SHALL NOT ask the Model to write out its reasoning (SC6.7).

### Requirement 5: Rule 7 with a label

**User Story:** As a card author, I want a recompiled button to keep its name, so that every script that names it still finds it.

#### Acceptance Criteria

1. Rule 7: WHEN the request is a Labelled_Request, THE Rule_Checker SHALL accept a Button_Reply only when its label is exactly the Request_Label: the same characters in the same case.
2. Rule 7: WHEN the request is an Unlabelled_Request, THE Rule_Checker SHALL check Rule 7 as today: the label is 1 to 24 characters long, is an English_Name, and is not the Same_Name as any name in `buttonNames`.
3. WHEN the request is a Labelled_Request, THE Rule_Checker SHALL check the reply's label only against the Request_Label, and not against English_Name or `buttonNames`.
4. WHEN a reply to a Labelled_Request breaks Rule 7, THE Rule_Checker SHALL give one Kept_Label_Report with the detail `The label <q(label)> is not the label in the request, <q(Request_Label)>.`, where `q` is the Compiler's `quote` and `label` is the reply's label.
5. WHEN a reply to a Labelled_Request breaks Rule 7, THE Compiler SHALL send the reply back to the Model with its reports, like every other broken rule, within the same at most three Model_Calls (SC5.3, SC5.4, SC5.7).
6. THE Rule_Checker SHALL check Rule 6 as today: every button that the script names as `button "<name>"` is the Same_Name as a name in `buttonNames` or as the reply's label.
7. WHEN a reply has `hasButton` false, THE Rule_Checker SHALL check it as today, for a Labelled_Request too: Rule 10 requires an empty label, and Rule 7 does not apply.
8. WHEN Rule 1 is broken in a reply to a Labelled_Request, THE Rule_Checker SHALL still check Rule 7 (SC4.11).
9. THE RULES sentence of Rule 7 SHALL state both cases, Labelled_Request and Unlabelled_Request, and the System_Prompt and the Retry_Message SHALL both use that one sentence.

### Requirement 6: Unlabelled requests stay as they are

**User Story:** As the developer of the UI, I want the first grow to work exactly as it does now, so that nothing I already ship changes.

#### Acceptance Criteria

1. FOR an Unlabelled_Request and any sequence of Model_Replies, THE Compiler SHALL send the same User_Message, accept and reject the same replies with the same reports, make the same number of Model_Calls, and return the same outcome as before this change.
2. THE System_Prompt and the Retry_Message SHALL differ from today's only in the RULES sentence of Rule 7 and, for the System_Prompt, the paragraph of Requirement 4.
3. THE existing tests of the properties P1, P2 and P3 and the two seeded generator cross-checks SHALL keep their code and SHALL pass, and their generators SHALL draw Unlabelled_Requests and their replies exactly as today.

### Requirement 7: The sentence-compiler documents

**User Story:** As a maintainer, I want the sentence-compiler spec to describe the contract and the rules as they now are, so that it stays the reference for the compiler.

#### Acceptance Criteria

1. THE Compiler_Spec requirements.md SHALL show the `label` line of the Contract change section in its contract, word for word.
2. THE Compiler_Spec requirements.md SHALL add the Request_Label to its glossary entry for Request_Names, define Request_Label, and say in its Introduction that recompiling sends the same request with the button's label.
3. THE Compiler_Spec requirements.md SHALL state the label checks of Requirement 2 as a new criterion SC2.8, Rule 7 with both cases in SC4.7 and SC3.2, the place of the label in the User_Message in SC6.5, and the paragraph of Requirement 4 as a new criterion SC6.8.
4. THE Compiler_Spec design.md SHALL describe the label in its "contract.ts" section, the new Rule 7 sentence in its rules table, the Kept_Label_Report in its table of report details, and the paragraph and the label in the User_Message in its "prompt.ts" section.
5. Each amended passage SHALL name this spec, `recompile-keeps-label`.
6. THE Change_Set SHALL NOT change the Compiler_Spec's tasks.md, its correctness properties or its testing strategy; this spec's documents describe the new tests.

### Requirement 8: Example tests

**User Story:** As a developer, I want an example test for each label case, so that a regression names the case it breaks.

#### Acceptance Criteria

1. THE Test_Suite SHALL include `readCompileRequest` tests for: no label; a good label; a label that is not English, accepted; an empty label; a Blank label; labels of Length 24 and 25; a label that is not a string; and a label that is already in `buttonNames` in another case.
2. THE Test_Suite SHALL include `userMessage` tests showing that the label appears only when the request has one, and then after `stackNames`.
3. THE Test_Suite SHALL include Rule_Checker tests for a Labelled_Request: an exact match passes; a different label, or the Request_Label in another case, gives exactly the Kept_Label_Report; and a script that names the kept label as `button "<label>"` passes Rule 6.
4. THE Test_Suite SHALL include System_Prompt tests showing that it holds the paragraph of Requirement 4 and that it is the same text after `userMessage` runs for a Labelled_Request, without holding its label.
5. THE Test_Suite SHALL replace `label` with another field name in the two tests that use it as a field the contract does not define: "drops fields that CompileRequest does not define" in `test/compiler/contract.test.ts` and "ignores fields that CompileRequest does not define" in `test/worker/handle.test.ts`.
6. THE Test_Suite SHALL include, in `test/worker/handle.test.ts`, bad-request tests for a bad label that check the 400 answer, no count and no Model_Call (SC14.6), and one Labelled_Request that the Worker answers 200 with the Request_Label, whose User_Message holds the label and whose log lines do not (SC11.2).
7. THE Test_Suite SHALL NOT make a network request or call the real Model (SC14.10).

### Requirement 9: Correctness properties

**User Story:** As a developer, I want the safety property to cover recompiles, so that no sequence of model replies can rename a recompiled button.

#### Acceptance Criteria

1. THE Test_Suite SHALL include property P1 with a label, tagged "P1 safety with a label": for any Labelled_Request and any sequence of fake Model_Replies (replies built to follow the rules for that request, replies built to break a named rule, unparsable replies, Refusals and failing calls), `compile` returns exactly the outcome the steps were built to give, every `ok: true` outcome carries exactly the Request_Label, and `compile` makes at most three Model_Calls.
2. THE replies built to break Rule 7 for a Labelled_Request SHALL include a reply whose label is a fresh English name, as a first grow would give, and a reply whose label is the Request_Label in another case, whenever that differs from the Request_Label.
3. THE P1 test with a label SHALL decide the expected outcome from how its generator built each fake reply, and not from the Rule_Checker (SC13.2).
4. THE generators SHALL draw Request_Labels of Length 1 to 24 that are not Blank and are not the Same_Name as any name in `buttonNames`, including labels that are not English_Names.
5. THE Test_Suite SHALL include seeded generator cross-checks for Labelled_Requests: every reply built to follow the rules passes the Rule_Checker with its own values, and every reply built to break a rule fails with a report for that rule.
6. THE Test_Suite SHALL run P1 with a label at least 200 times.

### Requirement 10: Scope and checks

**User Story:** As the maintainer, I want the change kept to the compiler, so that the UI and the deployment stay mine.

#### Acceptance Criteria

1. THE Change_Set SHALL modify only files in `src/compiler` and `test/compiler`, the file `test/worker/handle.test.ts` (Requirement 8.5 and 8.6), the Compiler_Spec's requirements.md and design.md, and this spec's documents, plus entries that the project's hooks add to `docs/kiro-log.md`.
2. THE Change_Set SHALL NOT modify `src/ui`, `src/hypertalk`, `test/hypertalk`, `worker/` or any deployment setting.
3. THE Compiler SHALL stay pure TypeScript that makes no network request (SC12.1), so that the scan test in `test/compiler/scan.test.ts` passes unchanged.
4. WHEN `npm run typecheck` and `npm test` run, THE Change_Set SHALL leave both passing.
