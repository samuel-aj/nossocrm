# Consolidated final fixes

Base: `06bb2af`. Scope: R1–R3 and the two new integration-test failures in `final-review.md`. The approved specification remains unchanged. This is the single consolidated final fix wave; no subagents were created.

## Changes

### R1 — selectors inside raw and nested focus traps

- `NativeSelect` now opens its portal inside the nearest `[data-focus-trap-fallback]` container. Every shared `FocusTrap`, including the raw board, Chats drawer, bot editor and lifecycle surfaces, supplies this boundary. Containing and nested traps stay enabled. The old dependency on the private Modal overlay context is removed from this control.
- Radix receives Escape in document capture. The selector stops propagation there while allowing Radix dismissal and automatic trigger-focus return. Parent drawer React handlers and the shared trap's Escape listener therefore do not also close their surfaces.
- The new raw-trap tests exposed an additional focus loss when searching with a nonempty current value: removing the selected option causes Radix to focus the list container. Filtering now hides and disables unmatched items while the menu is open, keeping item refs stable. Hidden items are excluded from accessibility/navigation and empty groups are hidden. The entire portal and every Radix Item remain unmounted while closed.
- New tests use actual shared FocusTrap components, without mocking them: one raw trap, an outer trap with a newly opened nested trap, and Modal with a nested raw trap. They assert portal containment, uninterrupted typing that filters out the selected option, Arrow/Enter selection, Escape from both search and an option, trigger-focus restoration, and no parent close callback.

### R2 — supported Evolution envelopes

- Both bounded context traversals now include contact, contact-list, static/live location, and all three supported poll-creation envelopes. Poll variants were another supported content branch omitted by the original allowlists and are covered within the same correction.
- Each parser has fixtures for all seven content envelopes, behind an existing supported wrapper, with a quoted provider reference and with forwarding alone. The adapter fixtures go through `EvolutionProvider.parseWebhook`; the Edge fixtures use the shared helper.
- Exact provider-reference extraction, the 32-node bound, scoped persistence, and query behavior are unchanged. No network reads, dependencies or schema changes were added.

### R3 — registered/native form synchronization

- The real select retains one stable native option. Its ref bridges imperative `.value` assignments from RHF into that option synchronously and into the visible uncontrolled value. RHF can immediately read the requested value even before React commits another render.
- Initial defaults, `reset(values)`, `setValue`, normal selection and closed typeahead use the same native value. Blur therefore reads the selected value instead of an empty or previous option.
- The existing native-shaped change-event contract is retained. Controlled owners keep authority over serialization even if they reject a typeahead change without rendering again.
- Radix's separate unnamed native form mirror has no options while the menu is closed. Its synthetic empty-value change is ignored; intentional empty selection uses the existing nonempty sentinel. This prevents the mirror from overwriting RHF defaults/programmatic values.
- New RHF tests assert visible label, native `.value`, `FormData`, watched value, blur/touched state and submitted value together for a non-first default, `reset({product: 'b'})`, `setValue('product', 'b')`, and closed typeahead. The existing mount-level test still proves zero closed Radix option mounts. An additional test covers a controlled owner rejecting closed typeahead.

### Integration-test adaptations

- `useLeadConversation.test.tsx` checks the visible `Ligação` label and now submits the activity, preserving the `CALL`, title and lead assertions.
- `BulkBotModal.test.tsx` uses a partial Modal mock and accessible Radix trigger/option interaction, with DOM pointer/scroll shims. Recipient preview, confirmed queue execution, shared batch ID and completion assertions remain intact.

## Verification

All commands ran in this worktree. Node toolchain prefix: `PATH=/Users/samuelmacario/.local/node/bin:$PATH`. Focused tests additionally used `env -u SUPABASE_SERVICE_ROLE_KEY`; no production launcher, credentials, browser writes or live business operations were used.

Final focused regression command:

```sh
env -u SUPABASE_SERVICE_ROLE_KEY PATH=/Users/samuelmacario/.local/node/bin:$PATH npm run test:run -- components/ui/NativeSelect.test.tsx components/ui/Modal.test.tsx components/ui/FormField.test.tsx features/deals/lead/LeadPropertiesPanel.test.tsx features/boards/components/Modals/DealDetailModal.test.tsx features/settings/components/LifecycleSettingsModal.test.tsx features/boards/components/Modals/BulkBotModal.test.tsx features/deals/lead/useLeadConversation.test.tsx lib/whatsapp/providers/evolution.quote.test.ts lib/whatsapp/providers/evolution.edit.test.ts lib/whatsapp/providers/evolution.delete.test.ts lib/whatsapp/providers/evolution.mentions.test.ts supabase/functions/whatsapp-webhook/quotes.test.ts
```

Result: **13 files / 144 tests passed**, exit 0. This includes 24 NativeSelect, 19 Edge quote, 9 provider quote, and the 9 tests in the two integration files identified by the final review. Earlier focused runs exposed missing happy-dom pointer shims, Radix filter-induced focus movement, and the unnamed native mirror's empty-value event; those were corrected before this final run.

```sh
PATH=/Users/samuelmacario/.local/node/bin:$PATH npm run typecheck -- --pretty false
```

Result: passed, exit 0.

```sh
PATH=/Users/samuelmacario/.local/node/bin:$PATH npx eslint --max-warnings 0 components/ui/NativeSelect.tsx components/ui/NativeSelect.test.tsx lib/whatsapp/providers/evolution.ts lib/whatsapp/providers/evolution.quote.test.ts supabase/functions/_shared/quotes.ts supabase/functions/whatsapp-webhook/quotes.test.ts features/deals/lead/useLeadConversation.test.tsx features/boards/components/Modals/BulkBotModal.test.tsx
```

Result: passed, zero warnings, exit 0.

```sh
PATH=/Users/samuelmacario/.local/node/bin:$PATH npm exec --yes --package=deno -- deno check --no-lock supabase/functions/_shared/quotes.ts supabase/functions/whatsapp-webhook/index.ts supabase/functions/whatsapp-webhook-meta/index.ts
```

Result: passed for the shared helper and both consuming Edge handlers, exit 0. No lockfile generated.

`git diff --check`: passed.

## Controller acceptance still required

The controller owns the final optimized build, whole suite, Chromium/WebKit matrix, real application raw-trap/clipping/stacking checks, cold/return performance comparison and production operations. Unit DOM evidence cannot establish real clipping or browser focus behavior. Server 3221 still served the pre-fix optimized build when this report was written; rebuild before those checks. No deploy, production messages, customer changes or historical repair was performed by this worker.
