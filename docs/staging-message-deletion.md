# Message deletion and outgoing edit display — STAGING

Own edited messages display only their current text and `Editada HH:mm`. Incoming edits keep the original struck through. A received deletion retains the last stored text struck through, with `Excluída HH:mm`; media is replaced with a deleted-media label. Deleted messages have no reply, forward, edit or delete actions.

Own CRM messages on a connected Evolution QR number expose `Excluir` for 48 hours after sending. A confirmation requests deletion for everyone using the message's original connection, provider ID and destination. The endpoint checks tenant, conversation access, author, sent status, provider and age server-side. It changes the CRM only after provider acknowledgement; deleted rows are retained as tombstones. The provider acknowledgement is not a guarantee that every recipient device has processed the deletion.

The pinned QR demo simulates editing, deletion (including cancellation), image paste/drop and sending locally. It includes an incoming deleted text sample. It never sends network requests.

## Dependencies before frontend deployment

- Apply `20260917133020_preserve_whatsapp_deleted_messages.sql` (additive `deleted_at`, trigger prevents stale updates from reviving content). Already applied ONLY to staging `mggvzlmquzqcloprxmoe`.
- Deploy `whatsapp-webhook` with `index.ts`, `edits.ts`, `deletions.ts`. Staging version 14. Existing custom webhook secret authentication is retained.
- Subscribe `MESSAGES_DELETE`; both initial provider setup and webhook subscription repair include it. Normalizes both Evolution deletion payload shapes and nested REVOKE protocol events, preserving stored content. An unknown target returns a retryable failure rather than creating fabricated content.
- Production still also needs the earlier original-body migration and edit handler, if these staging changes are promoted.

## Verification

- 39 focused tests pass: deletion authorization/eligibility/provider acknowledgement, cancellation/local demo, outgoing versus incoming edit display, deletion normalization/persistence, existing edit and image-transfer behavior.
- TypeScript and scoped ESLint pass.
- Bundled real chat components verified in Chromium and WebKit: own original hidden after edit, cancel/confirm deletion, incoming deleted text strike, no actions on deleted messages, image paste/drop, mobile layout, zero network requests from demo.
- Actual deployed staging webhook: isolated temporary organization/connection with no provider token or forwarding URL; synthetic incoming deletion returns 200, retains text, updates preview. Later edit returns 200 and cannot revive text. Direct stale database update also cannot clear the tombstone. Temporary fixtures cleaned up. No real WhatsApp messages sent/edited/deleted.
- Local default build encountered the worktree's external `node_modules` symlink limitation in Turbopack. Deployment build runs with independently installed dependencies on Vercel.

Main remains unchanged. Re-fetch both branches and inspect their diff before any later promotion, preserving concurrent main updates; do not copy staging demo gates into production blindly.
