---
inclusion: always
---
# Stack Séance — product

Stack Séance resurrects HyperCard. You describe a button in one plain-language sentence, and the card grows that button — and the next card it leads to.

## The flip

Every card can be flipped over. The back shows each plain-language sentence next to the HyperTalk script it became, one to one:

| Front: what you said | Back: what runs |
|---|---|
| "Clicking this button goes to the next card." | `on mouseUp` / `go to next card` / `end mouseUp` |

- The script on the back is the thing that actually runs. People can read it and edit it, and editing it changes the card immediately.
- It is not an explanation written after the fact.

## Where the AI is, and where it isn't

- A sentence passes through the LLM once, when the card is written: it is compiled into a script in our HyperTalk subset and stored in the card.
- At runtime our own small interpreter runs that script. Running a card never calls the AI.
- Editing the sentence on the back and pressing Recompile writes the script again.

## Why

When the AI mishears, you can see where and fix it yourself. You said "go to the next card" and it jumps back to card 1; flip the card, see `go to card 1`, change one line. After enough backs, you start writing that line yourself. The demo uses this example.

## Scope

- The learning part is the flip and nothing else: no courses, levels, or progress tracking.
- The app itself — cards, buttons, navigation — is a complete product, not a proof of concept.
