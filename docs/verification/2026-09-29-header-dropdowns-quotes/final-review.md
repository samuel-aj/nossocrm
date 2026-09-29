# Final whole-branch review

Reviewed base `d4e2d8b` through `06bb2af`, the approved header/dropdown/quote specification, complete integration diff, affected consumers, and both SDD ledgers/reports. Read-only review; no source, index, or Git changes. This report is the only written artifact. No focused suite was rerun.

## Verdicts

- **Specification: needs fixes.** Header structure, independent slots, group controls, unchanged composer identity, bounded snapshots and scoped incoming quote resolution are implemented. Modal keyboard/focus support and preservation of all previously supported context shapes have integration defects below. Registered form compatibility is incomplete.
- **Quality: needs fixes before publication.** R1 and R2 affect active screens/message ingestion. R3 is a shared-control contract defect with a currently unreferenced application consumer; it is not evidence that the active activity modal is broken. The controller also has two new suite failures to repair.
- **Release acceptance: pending.** Final build and the specified real-browser/performance matrix were still pending at review time. Passing task suites alone does not close those gates.

## Important findings

### R1 — P1: Portal selectors cannot retain focus inside the application's raw FocusTrap surfaces

**Primary location:** `components/ui/NativeSelect.tsx:187` (portal) and `components/ui/NativeSelect.tsx:67` (overlay notification).

`Select.Portal` attaches outside the existing dialog, while `useModalOverlay(open)` only notifies the private context supplied by `components/ui/Modal.tsx`. Several migrated, active consumers live under a direct `FocusTrap` without that provider: the desktop deal modal (`features/boards/components/Modals/DealDetailModal.tsx:578`), the Chats properties drawer (`features/chats/LeadDetailsAside.tsx:26`), the robot editor (`features/wa-agents/BotEditor.tsx:885`), and lifecycle settings (`features/settings/components/LifecycleSettingsModal.tsx:75`). Those traps remain active when their NativeSelect opens.

The installed focus-trap explicitly intercepts focus entering a node outside its container and moves it back (`node_modules/focus-trap/dist/focus-trap.js:687`, `:776`). `allowOutsideClick` permits clicks but does not release this focus rule. The new search input and keyboard option focus therefore compete with the parent trap; the search cannot reliably retain typing focus, and Arrow/Enter navigation cannot operate normally. Escape can additionally reach the parent close handler while the menu is open. This affects product selection in the lead panel and multiple controls in the bot editor, not only an isolated generic component.

**Required correction:** coordinate portal ownership with every active containing trap (including nested drawer/modal traps), or place the portal inside the appropriate trap boundary. Preserve overlay stacking/clipping and restore trigger focus. Verify an actual raw-trap product search with typing, Arrow/Enter, Escape that closes only the menu, and focus return in the mobile Chats drawer and desktop board modal. The lifecycle mouse-click test does not exercise this contract.

### R2 — P2: The new context allowlists drop reply/forward metadata for supported location and contact-list messages

**Primary location:** `supabase/functions/_shared/quotes.ts:45`. Also `lib/whatsapp/providers/evolution.ts:484`.

The previous parser scanned the unwrapped message's child values for `contextInfo`. Its replacement only follows a named list. The Edge list omits `contactsArrayMessage`, `locationMessage`, and `liveLocationMessage`; the provider adapter omits those plus `contactMessage`. Both content extractors already explicitly support these message types (`supabase/functions/whatsapp-webhook/index.ts:135`, `:140`, `:150`; `lib/whatsapp/providers/evolution.ts:529`, `:534`, `:546`).

A supported incoming message shaped as `message.locationMessage.contextInfo = { stanzaId, quotedMessage, isForwarded }` now inserts its normal location/text content but loses the quote and forwarding marker. The same applies to the omitted contact envelopes. This is a regression from the generic scan, even though the new top-level HOPE fixture succeeds.

**Required correction:** retain bounded traversal and include the previously supported content envelopes in both parsers. Add regression fixtures for nested location/live-location/contact-list context and adapter contact context, including forwarding without a quote. Keep the provider-reference match exact.

### R3 — P2: Registered uncontrolled values can diverge from the visible selector and submitted form state

**Primary location:** `components/ui/NativeSelect.tsx:92` and `:115`; related `:49`, `:87`, `:147`.

The ref exposes a real select, but only `.focus()` is bridged to React state. React Hook Form initializes/defaults and `setValue()`/`reset(values)` by assigning `fieldReference.ref.value` (installed RHF source `node_modules/react-hook-form/dist/index.esm.mjs:1692`). Those assignments never change `internalValue`. While closed, the hidden select contains only the current option, so assigning another registered value can also produce an empty native value. The trigger continues showing the old value even when RHF stores the new one.

There is a second manifestation during the new closed-trigger typeahead: `change(next)` assigns `native.value` before React renders the new sole option. For a different value the assignment reads back as empty; the synthetic event includes `target.type`, so RHF reads that actual registered DOM value instead of the supplied `target.value` (RHF `:1772`). A later blur can likewise overwrite the form value from the stale native control.

**Impact qualification:** `SelectField` advertises this registration contract and was migrated in this branch. Its concrete consumer, `features/activities/components/ActivityFormModalV2.tsx:91`, uses `reset(values)` but a repository reference search finds no import/mount of that V2 module. The active `ActivityFormModal` uses controlled props and does not demonstrate this defect. Accordingly this is an incomplete shared API/spec contract, not an established active activity-form production regression.

**Required correction:** implement a deliberate controlled form integration or fully synchronize imperative registration writes and native values. Cover non-first `defaultValues`, `reset({product: 'b'})`, `setValue('product', 'b')`, closed typeahead, blur, visible label and submitted value together. The existing `reset()` to an empty initial value does not cover these paths.

## Known integration test failures reported by controller

- `features/deals/lead/useLeadConversation.test.tsx:73`: the migrated combobox is a Radix button, so the old native `.toHaveValue('CALL')` assertion no longer expresses the visible control contract. Preserve verification of the prefilled activity and submitted type using appropriate assertions/interactions.
- `features/boards/components/Modals/BulkBotModal.test.tsx:6`: its full mock of `components/ui/Modal` omits `useModalOverlay`, now imported by NativeSelect. Use a partial mock or expose the hook and migrate any native-selection interaction while retaining behavior assertions.

Controller's run: **947 passed / 13 failed / 5 skipped (965 total)**, versus 11 known baseline failures. This review did not rerun that suite or independently reclassify baseline failures.

## Positive integration evidence

- Chats supplies `headerActions` and `headerContext` separately from timeline. Identity precedes CRM context; group Etiquetar remains available; board timeline header slots remain present. Selection key/composer placement were preserved. Stage confirmation logic was not rewritten.
- Quote original reads constrain organization, conversation and conversation connection. Duplicate enrichment patches quote columns only and compares null `quoted`; ordinary messages do not incur an original lookup. Returned/thrown quote lookup and enrichment failures fall back without blocking normal ingestion or Meta edit processing.
- Preview author/direction fallbacks do not invent a group sender; known deletion hides preview text/image. Stored snapshot supports originals outside the loaded page. Snapshot text is bounded to 300 characters.
- No added browser/provider read path for quote rendering, no new polling, database migration, RLS changes, or dependencies. The controller's reported route test used the same DB table-call sequence with and without a stored quote.
- Conditional mounting addresses Radix's detached closed-content behavior; reported mount-level evidence showed zero closed option nodes. The remaining form synchronization issue is listed separately above.

## Evidence gaps / remaining controller acceptance

- Optimized build result and final changed lint/typecheck after the consolidated fix wave.
- Chromium and WebKit at 1600/1024/390, both themes, long labels, modal/search keyboard behavior, drawer changes, draft preservation, exact funnel confirmation, board controls, and group states. Include the actual raw FocusTrap surfaces from R1; mocked workspace tests cannot establish this.
- The approved 10 cold / 10 return comparison with request counts, bytes, distributions/p90 and peaks against the baseline. No added query code is strong structural evidence but not a measured latency result.
- Production Edge function matching/deployment and the exact historical repair remain controller responsibilities. The reports distinguish the provider's stored HOPE shape from the unavailable original webhook envelope; retain that qualification.
- Temporary authentication cleanup and staging isolation are operational controller gates, not code defects identified by this review.

## Overall recommendation

Fix R1–R3 and the two new suite integration failures, perform targeted regression checks for those fixes, and finish the controller's build/browser/performance gates before publication. No additional access/isolation or ingestion-error blocking defect was found in the reviewed quote integration.
