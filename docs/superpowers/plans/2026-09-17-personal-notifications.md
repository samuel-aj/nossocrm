# Personal Notifications Implementation Plan

> Execute inline in this session, as authorized by Samuel. No further handoff is required.

**Goal:** Deliver opt-in personal message/board notifications in STAGING.
**Architecture:** Transactional service-only event journal; scoped API enriches authorized events; global client poller coordinates local presentation across tabs.
**Tech Stack:** Next.js 16, TypeScript, Supabase Postgres, TanStack Query, Web Locks, Notifications API.
**Spec:** docs/superpowers/specs/2026-09-17-personal-notifications-design.md

## Global Constraints
- STAGING only; preserve latest MAIN updates and the existing isolated chat demo.
- Settings scoped to authenticated user and active organization; defaults off.
- No real WhatsApp sends during verification.
- Desktop permission requested only from explicit user interaction.

## Task 1 — event capture and settings
Files: migration `personal_notifications`; lib/notifications/types.ts.
- [x] Define Preferences {messages:boolean, scope:'own'|'all', leads:boolean, boardIds:string[], desktop:boolean, sound:boolean} with strict Zod validation.
- [x] Create private event/preferences tables with RLS and service_role grants only.
- [x] Trigger inserts new_message only for incoming message INSERT and new_lead for deal INSERT or board transfer; ignore stage-only updates.
- [x] Verify transactional inserts, rollback fixtures, and access grants in STAGING.

## Task 2 — scoped feed and preferences API
Files: lib/notifications/server.ts; app/api/notifications/{preferences,events}/route.ts.
Interfaces: getSettings(auth), saveSettings(auth,Preferences), feed(auth,since,after).
- [x] Add server-side permission tests for board/team/connection/labels/own scope.
- [x] Hydrate source IDs in batches and return {events:Notice[],serverTime,nextAfter}.
- [x] Validate settings against visible board IDs; never accept org/user overrides.
- [x] Verify route auth, validation, and exact source links with tests.

## Task 3 — browser delivery and bell UI
Files: lib/notifications/delivery.ts; components/notifications/{usePersonalNotifications,NotificationPreferences}.tsx; NotificationPopover.tsx; features/chats/ChatsPage.tsx.
Interfaces: Notice {id,kind,title,message,href,createdAt}; presentOnce(scope,notice,callback).
- [x] Add client dedupe and default-preference tests.
- [x] Poll live events every four seconds with bounded recent overlap, pagination and baseline on preference changes.
- [x] Use Web Locks with storage markers; maintain recent notices and show clickable toast. Request desktop permission and unlock optional audio on interaction.
- [x] Add personal preferences and recent list to bell; exact conversation deep links.
- [x] Provide simulated alert buttons, labelled as test, with no sends.

## Task 4 — verification and staging release
- [x] Focused tests; TypeScript; lint modified files; build.
- [x] Apply migration to STAGING and run rollback SQL verification; inspect security advisors for new objects.
- [x] Browser-check settings, save/reload, simulated alert, multi-tab dedupe; no real sends.
- [ ] Commit and push STAGING only, verify Ready deployment and report testing limits.
