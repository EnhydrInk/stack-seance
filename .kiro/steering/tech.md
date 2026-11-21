---
inclusion: always
---
# Tech

- TypeScript in the browser, built with Vite, shipped as a public web app with a URL.
- Tests run on vitest; property-based tests use fast-check.
- The HyperTalk interpreter is pure TypeScript and never touches the network. Only the authoring-time compiler talks to an LLM.
- Interpreter errors always name the script line they come from, so the back of the card can point at it.
