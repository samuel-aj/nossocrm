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
