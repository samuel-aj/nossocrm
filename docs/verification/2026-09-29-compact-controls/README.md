# Compact lead selector and Details icon

## Approved scope

Match the linked-lead selector height to the adjacent stage selector in the chat header, and use the Lucide Info icon for Detalhes in the shared chat/board properties panel.

## Implementation

- Override the linked-lead trigger's inherited `min-h-9` with `min-h-0`, retaining the existing compact padding and typography. Other NativeSelect uses keep their default dimensions.
- Replace only the Detalhes section icon with Info. FolderOpen remains available for custom-field groups.
- No changes to data fetching, mutations, query keys, backend, dependencies or staging.

## Checks before publication

- Two new regression tests reproduced the prior behavior before the implementation and pass after the correction.
- 84 tests passed across ChatCrmHeader, LeadPropertiesPanel, NativeSelect, StageCascadePicker and DealStageControl.
- TypeScript, lint for all four changed TSX files, diff whitespace validation, and optimized Next.js webpack build passed.
- Production baseline: linked-lead trigger 36 px, adjacent stage trigger 26 px at 1600, 1024 and 390 px viewport widths.
- Candidate browser checks passed in Chromium and WebKit: both triggers measure 26 px at all three viewport widths; no horizontal overflow; search, keyboard navigation, Escape focus and draft preservation passed; Info is present in chat and board.
- The first WebKit run completed all UI checks but captured canceled RSC prefetch errors during a forced full-page navigation. Repeating with separate chat/board tabs avoids canceling in-flight navigation and passes with no page errors. Both runs are retained in the external verification artifacts.
- React review: bounded class override and existing icon import only; no hooks, new state, listeners or requests.
