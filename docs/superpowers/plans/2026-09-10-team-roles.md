# Team roles implementation plan

Goal: implement the approved master and per-funnel access model exclusively in staging.
Architecture: retain organization roles, store the master separately, add reusable roles and assignments, and enforce equivalent rules in the server and restrictive database policies. Preserve legacy permissions during migration.
Stack: Next.js, React, Zod, Supabase/Postgres, Vitest.

- [x] Confirm staging database and Vercel branch-specific environment.
- [x] Add role schemas and pure permission resolver in lib/permissions/teamRoles.ts; test own/all, unassigned, per-board actions, invalid and missing rules.
- [x] Add server authority/resolution helpers and protected management APIs for master, roles and member assignment.
- [x] Add Supabase migration for master, roles, assignments, audit, permission functions, restrictive policies and write guards. No automatic master assignment.
- [x] Restrict existing user, invitation and visibility management to master/super admin; preserve read-only team listing for admins and hide technical users.
- [x] Add team configuration UI with master selection for super admins, role assignment and per-funnel role editor.
- [x] Scope client action permissions by organization/user/board and clear entity caches when permissions change.
- [x] Audit privileged lead/contact endpoints and enforce visibility beyond direct database reads.
- [x] Validate real allow/deny database operations in rolled-back transactions, API tests, UI tests, typecheck, scoped lint and build.
- [ ] Publish only staging and verify deployment. Do not promote to main.

Reference: ../specs/2026-09-10-team-roles-design.md

Validation: 44 focused tests; TypeScript; scoped ESLint; production build; rolled-back staging SQL assertions. No master assigned. Service-only management tables intentionally have RLS without client policies or client grants.
