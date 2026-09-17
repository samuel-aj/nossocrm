# Incoming encrypted edits — 2026-09-17

Production investigation reproduced the reported failure with Evolution 2.3.7: the original incoming text was stored, but the edit was a `messages.upsert` containing `secretEncryptedMessage` with `secretEncType=2`. The provider itself still retained the old original text. The existing webhook ignored this encrypted envelope as contentless.

The receiver now loads the original message through the original connection's read-only `chat/findMessages` endpoint, derives the Message Edit key (HKDF-SHA256) and authenticates/decrypts with AES-GCM. It decodes only supported WAProto text edit fields, then uses the existing scoped, idempotent edit persistence path. The original message's key supplies sender identity: the encrypted target key is expressed from the client's perspective and cannot be used directly.

References: WhiskeySockets/Baileys `src/Utils/reporting-utils.ts`, `WAProto/WAProto.proto`, and PR #2554 (`https://github.com/WhiskeySockets/Baileys/pull/2554`). Evolution issue #2545 documents the same envelope symptom.

Safeguards: tenant/connection lookup before provider access, original-provider-ID and conversation/sender validation, authenticated ciphertext only, bounded protobuf parsing, provider timeout, no message sending, no keys stored in CRM/browser/logs. Deleted messages are skipped; malformed/failed incoming edits return a retryable error. Incoming encrypted edits only; the previously working outgoing edit/delete paths are unchanged.

Validation: 21 tests pass (9 new cryptographic/envelope/security/lookup tests plus the 12 existing edit/deletion tests); strict standalone TypeScript check passes. The actual reported encrypted event was decrypted locally with the implementation, reproducing the exact corrected text and edit timestamp (09:55). Real customer content and message secrets are not committed as fixtures; tests generate synthetic envelopes.

No UI or database migration is needed. Deploy `index.ts`, `edits.ts`, `deletions.ts`, and `encrypted-edits.ts` together, first in STAGING. Preserve MAIN's existing diagnostic event handling when promoting.
