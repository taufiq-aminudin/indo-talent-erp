# V6.29 — Screening Result UI Fix

Root cause: the actual AI/Rule button handlers were still calling a legacy
`showResult()` function that rendered `JSON.stringify(...)` into `#resultText`.
V6.28 added a renderer but did not replace that legacy function.

V6.29:
- routes `showResult()` through `renderScreeningResult()`;
- gives AI errors a professional error card;
- gives successful results a score/status/summary/skills layout;
- adds self-contained CSS;
- bumps app.js cache version to 629.

Backend logic is preserved.
