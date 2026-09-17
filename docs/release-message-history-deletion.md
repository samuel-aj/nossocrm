# Production promotion — 2026-09-17

Authorized after user approval of STAGING `3b8a1f4`. Release is based on latest MAIN `4342086`, with only the approved functional changes copied from staging: lead title ellipsis/full-title hover, received edit history, own edits displaying only current text, own-message deletion with confirmation, and incoming deletion tombstones. Staging demo pages, components and flags are not part of this promotion.

Concurrent MAIN protections: reconnect mappings for agents/bots, organization membership owner resolution, zombie Evolution connection detection, board width/shared scrolling and previous reporting changes remain in place. Re-fetched main and staging before promotion; main did not advance during preparation.

Production Supabase identified from the currently published CRM client: `pldknngsszuxiuweivdz`. Applied both additive migrations and aligned their recorded versions with the repository/staging timestamps (`20260917130238`, `20260917133020`). Transactional synthetic-fixture verification with rollback confirmed first-text preservation and protection against revival of deleted content. No real messages were changed.

Compared deployed webhook v23 with MAIN before updating. Preserved its existing `diag.find` diagnostic-event exclusion from debug logging. Published v24 with `index.ts`, `edits.ts`, `deletions.ts`, keeping the existing custom secret authentication. Subscription repair includes edit and delete events for existing Evolution connections.

Validation: TypeScript, scoped ESLint, 36 focused chat/backend tests and 46 regression tests (board filters/deep links, quote/service-window/edit rules and agent/bot connection mappings) passed. UI behavior had already been verified in WebKit and Chromium in staging. Production deploy is triggered by the MAIN push and must report Ready before completion.
