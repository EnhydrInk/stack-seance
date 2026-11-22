# Requirements Document

## Introduction

This spec adds one navigation command to the HyperTalk interpreter: `go [to] stack <expression>`. The planned UI holds several stacks: a Home stack whose card has one icon button per stack, and the haunted house. The icon buttons run scripts such as `go to stack "Haunted House"`.

The command is a kind of `go`. The parser treats its target like the target of `go [to] card <expression>`. The runtime opens the named stack at its first card with the pending visual effect (R3), then runs that card's `openCard` exactly as after `go to card`, with the same depth limit and error reporting (R2.5, R12, R14). Stacks are found by name only: there are no stack numbers.

The Host gains exactly two methods, `findStackByName` and `goToStack`, and a `StackRef` type, so the UI can be written against them now. Every existing card call of the Host refers to the current stack.

This spec changes code only in `src/hypertalk` and `test/hypertalk`, and amends the documents of the existing hypertalk-interpreter spec. It has no UI work.

Out of scope: `go home`, `go to card … of stack …`, `go back`, new handlers such as `openStack`, and any UI.

## Glossary

- **Interpreter_Spec**: the existing spec in `.kiro/specs/hypertalk-interpreter/` (requirements.md and design.md). R-numbers such as R2.5 and property names P1 to P6 in this document refer to the Interpreter_Spec. The requirements of this document are numbered Requirement 1, Requirement 2, and so on.
- **Parser**: `parse` and `parseUnguarded` in `src/hypertalk/parser.ts`.
- **Printer**: `print` in `src/hypertalk/printer.ts`.
- **Runtime**: `runHandler` and `runHandlerUnguarded` in `src/hypertalk/runtime.ts`.
- **Keyword_Table**: `KEYWORDS` in `src/hypertalk/tokens.ts`. Together with `true` and `false` it gives the reserved words of R8.4.
- **Host**: the `Host` interface in `src/hypertalk/host.ts` (R10), and any object that implements the interface.
- **Public_API**: the exports of `src/hypertalk/index.ts`.
- **FakeHost**: the in-memory host in `test/hypertalk/helpers/fakeHost.ts` (R10.3).
- **Generators**: the fast-check arbitraries and the seeded source renderer `renderScript` in `test/hypertalk/helpers/arbitraries.ts`.
- **Test_Suite**: the vitest tests in `test/hypertalk`, run with `vitest --run`.
- **Change_Set**: every file this spec adds or modifies.
- **Stack**: a named, ordered list of one or more cards held by the Host. Every card belongs to exactly one Stack.
- **StackRef**: `{ id: string; name: string }`, a Stack as the Host reports it.
- **Current_Stack**: the Stack that holds the current card.
- **First_Card**: the card at position 1 of a Stack.
- **Stack_Go**: the statement `go [to] stack <expression>`.
- **Card_Go**: the existing statement `go [to] card <expression>` (R2.1).
- **Primary_Expression**: the `primary` rule of the Interpreter_Spec grammar: a string literal, a number literal, `true`, `false`, `it`, a variable name, `field "<name>"`, or an expression in parentheses.
- **Calculation_Operator**: one of `+`, `-`, `*`, `/`, `&`, `&&`.
- **Stack_Name_Text**: the value of the target expression of a Stack_Go converted to a string, with numbers converted by `String(n)` (R11.8).
- **Pending_Effect**: the visual effect that a `visual effect` statement remembers for the next `go` (R3.2).
- **Script_Id**: the `scriptId` of an error, which names the card whose script raised the error (R12.5).
- **Open_Depth**: the number of `openCard` handlers that `go` statements have started one inside the other. The handler run that the caller starts has Open_Depth 0.
- **Depth_Limit**: 16, the value of `MAX_OPEN_CARD_DEPTH` in `src/hypertalk/runtime.ts` (R14.4).
- **Stack_P2**: the navigation property for Stack_Go defined in Requirement 9. The existing P2 property is called the card P2.

## Requirements

### Requirement 1: Parse go to stack

**User Story:** As a card author, I want to write `go to stack "Haunted House"` in a button script, so that an icon button on the Home card opens another stack.

#### Acceptance Criteria

1. THE Parser SHALL accept `go to stack <Primary_Expression>` and `go stack <Primary_Expression>`, with the keywords in any case, as a `go` statement whose target is `{ k: 'stack', expr }`.
2. THE Parser SHALL produce the same syntax tree, ignoring positions, for `go stack <e>` and `go to stack <e>`.
3. THE Parser SHALL accept a Stack_Go in every place where the grammar accepts a statement, including the then and else parts of both `if` forms (R9.1, R9.2).
4. IF a Calculation_Operator follows the Primary_Expression of a Stack_Go, THEN THE Parser SHALL report a syntax error on that line, at the operator, whose message tells the author to put the calculated stack name in parentheses and shows an example that starts with `go to stack (`.
5. IF no Primary_Expression follows the word `stack` in a Stack_Go, THEN THE Parser SHALL report a syntax error on the line of that `go`.
6. IF a token that can neither continue nor end the statement follows the Primary_Expression of a Stack_Go, as in `go to stack "A" "B"`, THEN THE Parser SHALL report a syntax error on that line.
7. IF the word after `go` or `go to` is none of `next`, `prev`, `first`, `last`, `card` and `stack`, THEN THE Parser SHALL report a syntax error on that line whose message lists `stack …` among the expected targets, together with next card, prev card, first card, last card and card ….
8. IF a script contains `go to card <expression> of stack <expression>`, THEN THE Parser SHALL report a syntax error on that line.
9. THE Keyword_Table SHALL contain the word `stack`.
10. IF a script uses `stack`, in any case, as the variable name in `put … into` or in `global`, THEN THE Parser SHALL report a syntax error on that line (R8.4).

### Requirement 2: Print go to stack

**User Story:** As a developer, I want the printer to write `go to stack` in canonical form, so that the round trip property covers the new command.

#### Acceptance Criteria

1. THE Printer SHALL print a `go` statement with a stack target as `go to stack ` followed by the printed target expression.
2. WHEN the target expression of a stack target is not a Primary_Expression, THE Printer SHALL print the target expression inside parentheses.
3. WHEN the Printer output for a syntax tree that contains stack targets is parsed, THE Parser SHALL return a tree equal to that syntax tree, ignoring positions (P1).

### Requirement 3: Find the stack by name

**User Story:** As a stack author, I want stacks found by name in any case, so that `go to stack "haunted house"` opens the stack named "Haunted House".

#### Acceptance Criteria

1. WHEN a Stack_Go runs, THE Runtime SHALL evaluate the target expression and convert the value to the Stack_Name_Text.
2. THE Runtime SHALL treat every Stack_Name_Text as a stack name, including text that looks like a number (R11.4), so `go to stack 3` selects the Stack named "3" and not the third Stack.
3. WHEN the Stack_Name_Text is not empty, THE Runtime SHALL call `findStackByName` on the Host with the Stack_Name_Text unchanged, keeping its case and spaces.
4. WHEN `findStackByName` is called, THE Host SHALL return the StackRef of the Stack whose name equals the given name ignoring case (R1.8), or `undefined` when no Stack has that name.
5. IF the Stack_Name_Text is the empty string, THEN THE Runtime SHALL report a runtime error on the line of the Stack_Go, whose message says that the stack name is empty, without calling `findStackByName`.
6. IF `findStackByName` returns `undefined`, THEN THE Runtime SHALL report a runtime error on the line of the Stack_Go, whose message quotes the Stack_Name_Text, and stop the handler run (R12.3).
7. IF a Stack_Go fails before `goToStack` is called, through an evaluation error in the target expression, an empty name, a missing Stack, or the Depth_Limit (Requirement 4.5), THEN THE Runtime SHALL clear the Pending_Effect without playing the effect (R3.3).
8. IF a Stack_Go fails before `goToStack` is called, THEN THE Runtime SHALL leave the Current_Stack and the current card unchanged, calling neither `goToStack` nor `goToCard`.

### Requirement 4: Open the stack at its first card

**User Story:** As a user, I want an icon button to open its stack at the first card with the chosen visual effect, so that every stack starts where its author meant it to start.

#### Acceptance Criteria

1. WHEN `findStackByName` returns a StackRef, THE Runtime SHALL call `goToStack` once with that StackRef and the Pending_Effect, and then clear the Pending_Effect (R3.2).
2. WHEN the named Stack is the Current_Stack, THE Runtime SHALL call `goToStack` all the same, so the First_Card of the Current_Stack becomes the current card even when another card of the Current_Stack was current.
3. WHEN `goToStack` is called, THE Host SHALL make the given Stack the Current_Stack, make its First_Card the current card, play the given effect with the change when an effect is given, and return the CardRef of the First_Card, whose index is 1.
4. WHEN `goToStack` returns a CardRef, THE Runtime SHALL get the script of that card with `getCardScript` and run the script's `openCard` handler with fresh local variables, the same global store, an Open_Depth one higher, and the id of that card as the Script_Id, exactly as after a Card_Go (R2.5, R14.2).
5. IF `findStackByName` returns a StackRef while the Stack_Go runs at an Open_Depth of Depth_Limit or more, THEN THE Runtime SHALL report a runtime error on the line of that Stack_Go, with the same message as a Card_Go gets at that depth, without calling `goToStack` (R14.4).
6. THE Runtime SHALL count the `openCard` handlers started by Stack_Go and by Card_Go in one Open_Depth, so a chain that mixes the two commands stops at the same Depth_Limit.
7. IF the `openCard` handler of the First_Card raises a runtime error, or the script of the First_Card has a syntax error, THEN THE Runtime SHALL return that error with its line in the script of the First_Card and the id of the First_Card as the Script_Id (R12.5, R14.3).
8. IF a deeper `openCard` handler, started by a `go` in the `openCard` handler of the First_Card, raises an error, THEN THE Runtime SHALL return that error with the Script_Id of the innermost card that failed, as for a Card_Go.
9. IF the `openCard` handler of the First_Card fails, THEN THE Runtime SHALL keep the new Current_Stack and current card and stop the handler that ran the Stack_Go (R12.3).

### Requirement 5: Continue in the new stack

**User Story:** As a card author, I want the rest of a button script to keep running after `go to stack`, so that later commands act on the stack the user is now in.

#### Acceptance Criteria

1. WHEN a Stack_Go and the `openCard` handler that the Stack_Go started both succeed, THE Runtime SHALL run the remaining statements of the handler that contains the Stack_Go.
2. WHEN a statement after a successful Stack_Go names a card by number, by name, or as next, prev, first or last card, THE Runtime SHALL get the card from the Host at the moment the statement runs, so the card is looked up in the new Current_Stack (R2.6).
3. WHEN a statement after a successful Stack_Go names a field or a button, THE Runtime SHALL ask the Host at the moment the statement runs, so the name resolves on the current card of the new Current_Stack (R2.6).
4. THE Runtime SHALL pass the global store of the handler that runs a Stack_Go to the `openCard` handler of the First_Card, and keep using the same global store for the rest of that handler, so global variables are shared across Stacks (R8.2).

### Requirement 6: Host interface for stacks

**User Story:** As the developer of the UI, I want the stack methods of the Host fixed now, so that I can write the UI host against them before the UI spec starts.

#### Acceptance Criteria

1. THE Host module SHALL export a `StackRef` interface with exactly the fields `id: string` and `name: string`, documented as "A stack as the host reports it."
2. THE Host interface SHALL declare `findStackByName(name: string): StackRef | undefined`, documented as "Case-insensitive; undefined when no stack has this name."
3. THE Host interface SHALL declare `goToStack(stack: StackRef, effect?: Effect): CardRef`, documented as "Makes `stack` the current stack, shows its first card with `effect`, and returns that card."
4. THE Host interface SHALL keep every other method as before, so `findStackByName` and `goToStack` are the only additions.
5. THE Host interface documentation SHALL state that `cardCount`, `currentCard`, `findCardByName`, `cardAt`, `goToCard` and `getCardScript` refer to the Current_Stack, and that `CardRef.index` is the 1-based position in the Current_Stack.
6. THE Host interface documentation SHALL state that card ids are unique across all Stacks.
7. THE Public_API SHALL export the `StackRef` type.
8. THE Runtime SHALL reach Stacks only through `findStackByName` and `goToStack`, and SHALL ask the Host for card and Stack state each time a statement needs that state, keeping no copy of the state (R10.1).

### Requirement 7: Fake host with stacks

**User Story:** As a developer, I want the fake host to hold several stacks and log the new calls, so that the tests can check `go to stack` without a browser.

#### Acceptance Criteria

1. THE FakeHost SHALL hold one or more Stacks, each with an id, a name and one or more cards, plus a Current_Stack and a current card in the Current_Stack.
2. WHEN a FakeHost is built from a `cards` list alone, THE FakeHost SHALL hold a single Stack with a default id and a default name, made of those cards with the default card ids `card-<n>`, so the existing test cases that build a FakeHost from `cards` pass without edits.
3. WHEN a FakeHost is built from a list of Stacks, THE FakeHost SHALL accept for each Stack a name, an optional id and the cards, plus an optional starting Current_Stack and current card that default to the first Stack and its First_Card.
4. WHEN a FakeHost is built from a list of Stacks, THE FakeHost SHALL give every card without an id a default id that is unique across all Stacks.
5. IF two cards in any Stacks share an id, two Stacks share an id, two Stack names are equal ignoring case, a Stack has no cards, or the starting Current_Stack or current card does not exist, THEN THE FakeHost constructor SHALL throw.
6. THE FakeHost SHALL answer `cardCount`, `currentCard`, `findCardByName`, `cardAt`, `goToCard` and `getCardScript` from the cards of the Current_Stack, and `getField`, `setField` and `setVisible` from the current card of the Current_Stack.
7. WHEN `findStackByName` is called, THE FakeHost SHALL log `{ call: 'findStackByName', name }` and return the StackRef of the Stack whose name equals `name` ignoring case, or `undefined`.
8. WHEN `goToStack` is called, THE FakeHost SHALL log a `goToStack` call with the Stack id and, when given, the effect, make that Stack the Current_Stack with its First_Card as the current card, and return the CardRef of that First_Card.
9. IF `goToStack` receives a StackRef whose id matches no Stack of the FakeHost, or whose name differs from the name of that Stack, THEN THE FakeHost SHALL throw and keep the Current_Stack and the current card unchanged.
10. IF `goToCard` or `getCardScript` receives a CardRef that does not match the card at that index in the Current_Stack, THEN THE FakeHost SHALL throw, as before this feature.
11. WHEN `clone` is called, THE FakeHost SHALL return an independent copy with all Stacks, the Current_Stack, the current card, the remaining replies and the log so far.
12. THE FakeHost SHALL let tests read the id and name of the Current_Stack without logging a host call.

### Requirement 8: Example tests

**User Story:** As a developer, I want example tests for each rule of `go to stack`, so that a regression points at the rule it breaks.

#### Acceptance Criteria

1. THE Test_Suite SHALL include Parser example tests for a Stack_Go with and without `to`, with the keywords in mixed case, with each kind of Primary_Expression as target, and inside both `if` forms.
2. THE Test_Suite SHALL include Parser example tests for the syntax errors of Requirement 1: a Calculation_Operator after the target, a missing target, a token after the target, an unknown word after `go` with a message that mentions `stack`, `go to card 1 of stack "A"`, `put 1 into stack` and `global stack`, each checked for its line.
3. THE Test_Suite SHALL include Printer example tests for a Stack_Go with a Primary_Expression target and with a target expression that the Printer puts in parentheses.
4. THE Test_Suite SHALL include Runtime example tests for an existing Stack, a Stack name in other case, a number target that matches a Stack named by that number, a number target with no Stack of that name, a missing Stack and an empty name.
5. THE Test_Suite SHALL include Runtime example tests for the Current_Stack as target, started from a card other than its First_Card, and for the Pending_Effect played with `goToStack` and dropped when the Stack is missing.
6. THE Test_Suite SHALL include Runtime example tests for the `openCard` handler of the First_Card running, and for a runtime error and a syntax error in that handler, each naming the id of the First_Card and the line in its script.
7. THE Test_Suite SHALL include Runtime example tests for the Depth_Limit reached through a chain of Stack_Go statements, for the rest of the handler running after a Stack_Go, and for a global variable shared between a button script in one Stack and the `openCard` handler of the First_Card of another Stack.
8. THE Test_Suite SHALL include Runtime example tests on a FakeHost whose second Stack has more cards than the Current_Stack, or has a card with the same name as a card of the Current_Stack, which show that card numbers, card names, next, prev, first and last card, fields and buttons resolve only in the Current_Stack, before and after a Stack_Go.
9. THE Test_Suite SHALL include FakeHost example tests for building from a list of Stacks, each constructor error of Requirement 7.5, `findStackByName`, `goToStack`, the logged calls, the read of the Current_Stack, and `clone` with several Stacks.

### Requirement 9: Correctness properties

**User Story:** As a developer, I want the fast-check properties to cover `go to stack`, so that generated scripts and stacks test the new command as hard as the old ones.

#### Acceptance Criteria

1. THE Generators for P1 SHALL produce Stack_Go statements with every expression form as target, and `renderScript` SHALL write Stack_Go statements with random keyword case and spacing, with and without `to`.
2. THE Test_Suite SHALL include the Stack_P2 property, tagged "P2 stack navigation", with at least 200 runs, over 1 to 5 Stacks with names unique ignoring case, each Stack with 1 to 4 cards whose ids are unique across all Stacks and whose First_Card has a script that is empty, valid, has a runtime error in `openCard`, or has a syntax error.
3. THE Stack_P2 property SHALL start each case at any Stack and any card of that Stack, and SHALL use a target name that is an existing Stack name as written, an existing Stack name in other case, or a name of no Stack, including the empty string.
4. WHEN a Stack_P2 case runs a `mouseUp` handler with one Stack_Go, THE Test_Suite SHALL check that exactly one outcome holds: (a) the result has no error, the Current_Stack is the target Stack and the current card is its First_Card; (b) the result is a runtime error on the line of the Stack_Go, and the Current_Stack and the current card are the ones before the run; (c) the result is the error of the `openCard` handler of the First_Card, with the id of the First_Card as the Script_Id and a line in 1..lineCount of that card's script, and the Current_Stack is the target Stack with its First_Card as the current card.
5. WHEN a Stack_P2 case runs, THE Test_Suite SHALL check that the outcome is the one that a model of the generated Stacks expects: outcome (a) or (c) when the name matches a Stack ignoring case, outcome (c) exactly when the script of that Stack's First_Card has an error, and outcome (b) when no Stack matches.
6. THE Test_Suite SHALL keep the card P2 property on a single Stack.
7. THE Generators for P3 and P5 SHALL build sessions with 1 to 3 Stacks whose card names are unique across the session, and `mouseUp` scripts that contain Stack_Go statements with existing Stack names in random case and with missing names.
8. THE P3 property SHALL compare, between the two runs, all Stacks, the Current_Stack, the current card, and the call logs including the `findStackByName` and `goToStack` calls.
9. WHEN a P5 error carries a Script_Id, THE P5 property SHALL find the script with that id in any Stack of the session.
10. THE P4 mutation Generator SHALL include `stack` among its replacement tokens, and the P4 check that at least 30% of the generated cases fail to parse SHALL keep passing.
11. WHEN the Test_Suite runs with `vitest --run`, THE Test_Suite SHALL pass.
12. THE Change_Set SHALL keep every existing example test case as written, except for the expected text of the message of Requirement 1.7, which `test/hypertalk/parser.test.ts`, `test/hypertalk/runtime.navigation.test.ts` and `test/hypertalk/helpers/lexMask.ts` spell out in full.

### Requirement 10: Amend the interpreter spec

**User Story:** As a developer, I want the original interpreter spec to describe stacks too, so that it stays the single description of the language and the host.

#### Acceptance Criteria

1. THE Interpreter_Spec requirements.md SHALL list stack names in R1.8 among the names compared ignoring case.
2. THE Interpreter_Spec requirements.md SHALL describe Stack_Go in R2: the syntax, lookup by name without stack numbers, the errors for a missing or empty name, opening at the First_Card, the `openCard` run, and continuing in the new Current_Stack.
3. THE Interpreter_Spec requirements.md SHALL name `stack` as a reserved word in R8.4.
4. THE Interpreter_Spec requirements.md SHALL list stack lookup by name and going to a Stack in R10.1, and SHALL state that the card calls refer to the Current_Stack.
5. THE Interpreter_Spec requirements.md SHALL include Stack_Go in the text of P1 and P3, the Stack_P2 property in the text of P2, and sessions with several Stacks in the text of P5.
6. THE Interpreter_Spec design.md SHALL describe `StackRef`, `findStackByName`, `goToStack`, the Current_Stack rule for card calls and the uniqueness of card ids across Stacks in its Host interface section.
7. THE Interpreter_Spec design.md SHALL include the `stack` target and its parenthesis rule in the grammar and the grammar notes, and the `{ k: 'stack'; expr: Expr }` variant in the AST `GoTarget` type.
8. THE Change_Set SHALL modify code only under `src/hypertalk` and `test/hypertalk`, and documents only under `.kiro/specs/hypertalk-interpreter` and `.kiro/specs/go-to-stack-command`, apart from the entries that the workspace's post-task hook appends to `docs/kiro-log.md`.
