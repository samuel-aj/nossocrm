# Final consolidated fix report

Base: `52061a0`. Commit identified by subject: `fix(crm): restore shared lead workspace parity and responsive drawers` (the commit containing this report; controller receives its hash).

## Findings addressed

1. **UTM editing:** partition visible custom-field definitions into ordinary and UTM definitions. UTM definitions use the same typed editor and canonical mutation, including nonstandard keys. Standard read-only fallback rows appear only when no definition exists; hidden defined fields cannot leak through a fallback. Regression edits standard text and nonstandard numeric UTM fields and checks both are disabled for a readonly user.
2. **Board conversation width:** observe the available board workspace, use a 360 px left column only when at least 480 px remain for conversation, otherwise show a left overlay on demand. Chat and panel remain mounted. Overlay traps focus, Escape closes properties, and focus returns to its trigger. Regressions cover available widths 704 (768 viewport minus collapsed navigation), 836 (900 minus navigation), and 660 (expanded navigation case), checking the same DOM chat and panel nodes remain mounted. Viewport/browser geometry remains controller acceptance.
3. **Confirmation text:** keep exact title and render lead identity plus separate De/Para rows. Invalid selection fallback preserved. Regression checks all approved copy.
4. **Effect notices:** lifecycle notice requires a contact; next-board notice requires a success destination, including configured won-stage and CUSTOMER fallback conditions. Tests cover ordinary, MQL, SALES_QUALIFIED, CUSTOMER, explicit won override and board CUSTOMER exclusions. Canonical move hook unchanged.
5. **Dialog name:** desktop board dialog now directly names the lead with `aria-label`. Accessible-role regression checks the resulting name.
6. **Tag colors:** extracted the exact baseline hash/palette into `tagMarkerStyle.ts`; shared chips now use those styles. Regression checks two different known palette entries.
7. **Growing description:** textarea ref and layout effect resize from scrollHeight on draft or business section changes. Existing failed-save retention tests remain; new regression checks growth to 240 px.
8. **Field group order:** ungrouped fields precede named groups sorted with `localeCompare(..., 'pt-BR')`, retaining field order within each group. Regression deliberately supplies Zebra before ungrouped and Análise definitions.

## Narrow Chats geometry

Controller measured a 390 px viewport/workspace with a 360 px drawer at x=-16, suggesting horizontal programmatic scrolling from focused overflowing content. Changed workspace `overflow-hidden` to `overflow-clip` to prevent that container from becoming a programmatically scrollable viewport. Shared panel now explicitly uses `w-full max-w-full min-w-0`. Drawer stays right anchored with width capped to its parent. CSS contract regressions cover both constraints. This is a targeted fix; real browser x/right/scrollLeft confirmation remains controller-owned and is not claimed by DOM tests.

## RED → GREEN evidence

- Initial tests were added before implementation. `/tmp/workspace-final-red.log`: **14 failed, 42 passed**. Every new regression failed for the reviewed missing behavior; no old regression failed.
- After implementation: initial three files **56 passed**.
- Narrow geometry CSS tests were added and run with the original two declarations temporarily restored: `/tmp/workspace-mobile-red.log`: **2 failed, 29 passed**. Restored the new declarations afterward. These are CSS contracts, not a browser layout simulation.
- Added supplemental positive/negative won-stage predicate cases.
- Final command: `npx vitest run features/deals/lead/LeadPropertiesPanel.test.tsx features/deals/lead/DealStageControl.test.tsx features/boards/components/Modals/DealDetailModal.test.tsx features/chats/ChatsPage.workspace.test.tsx`: **65 passed across four files**, `/tmp/workspace-final-green.log`.
- `npm run typecheck`: pass, `/tmp/workspace-final-types.log`.
- ESLint for all nine changed source/test files: pass, `/tmp/workspace-final-lint.log`.
- `git diff --check`: pass.

## Changed files

- `features/deals/lead/LeadPropertiesPanel.tsx` and `.test.tsx`
- `features/deals/lead/DealStageControl.tsx` and `.test.tsx`
- `features/deals/lead/tagMarkerStyle.ts`
- `features/boards/components/Modals/DealDetailModal.tsx` and `.test.tsx`
- `features/chats/ChatsPage.tsx` and `ChatsPage.workspace.test.tsx`
- This report.

## Scope and remaining acceptance

No schema, production writes, staging, build, server lifecycle or deployment actions. Root verification document/evidence left untouched. Approved canonical writes, selection/revision guards and exact confirmation title preserved. Controller owns final real-browser drawer geometry/focus acceptance, performance comparisons and full build/suite. No known remaining unit/type/lint failure in this scoped wave.

## Finding 9 continuation: responsive header containment

Controller's real-browser run of `f12edfd` exposed the remaining cause: at 390 px, the unwrapped CRM header placed the properties button beyond the viewport. `overflow-clip` correctly prevented horizontal container scrolling but could not contain that header by itself. Board 768/900 geometry passed. Finding 9 therefore remained open after the first commit; the initial CSS-only regression did not establish browser acceptance.

Continued the same scoped geometry correction: CRM header and its context/actions groups now wrap within their available width; lead selector has `min-w-0`; owner chip constrains and truncates long names. All lead, labeling, selector and properties actions remain available. No other layout or behavior is changed.

Added the regression before this correction: `/tmp/workspace-header-red.log` has **1 failed, 5 passed**; after correction `/tmp/workspace-header-green.log` has **6 passed**. This checks the containment CSS and continued presence of existing actions; the controller still owns actual 390 px click/rect acceptance. Typecheck and changed-file ESLint passed (`/tmp/workspace-header-types.log`, `/tmp/workspace-header-lint.log`); diff check passed. Changed files for this continuation: `ChatsPage.tsx`, `ChatsPage.workspace.test.tsx`, and this report. Commit subject: `fix(chats): contain CRM header actions on narrow screens`.

## Finding 9 continuation: bottom navigation containment

Controller confirmed horizontal geometry x=30/width=360 and all ten functional checks, then measured the final drawer section behind the 56 px bottom navigation at 390×844. Its `Detalhes` center hit the navigation rather than the section. The absolute drawer ignored the workspace's existing bottom padding.

Replaced drawer `inset-y-0` with `top-0` and a bottom inset calculated from the same `--app-bottom-nav-height` and `--app-safe-area-bottom` variables. Both default to zero; the non-drawer desktop column is unchanged. CSS regression added before the final declaration: **1 failed, 6 passed**, then **7 passed** (`/tmp/workspace-bottom-red.log`, `/tmp/workspace-bottom-green.log`). An initial inline-style assertion was rejected by happy-dom's calc/var style parser, so the final regression checks the Tailwind declaration instead. Typecheck and changed-file lint passed; diff check passed. Controller owns the final browser hit-target confirmation. Changed files: `LeadDetailsAside.tsx`, `ChatsPage.workspace.test.tsx`, this report. Commit subject: `fix(chats): keep properties drawer above bottom navigation`.
