# Integrated header, selectors and quoted messages — verification

Code reviewed: `53e2836` (base `d4e2d8b`). Date: 2026-09-29.

## Scope

- Approved integrated header: conversation identity first, CRM context second, accessible properties/search, and no duplicated owner/stage while properties are visible.
- Shared design-system selectors across active migrated screens, retaining existing local option data, empty/disabled values, form submission, search, keyboard and modal behavior. Closed menus do not mount Radix option trees.
- Tag stays the tag icon; custom fields use List; UTMs use Radar. The shared lead panel covers both board and Chats.
- Bounded quoted-message snapshots, including the reported top-level provider context and supported wrapped contact/location/poll contexts. Existing message responses render snapshots without per-bubble lookup, polling or additional history loading. Original-message resolution is scoped to organization, conversation and connection, is conditional on a quote, and is fail-soft. Duplicate delivery only conditionally enriches quote fields.

## Automated checks

- Full suite: **971 passed / 11 failed / 5 skipped / 987 total**. All 11 failures match the preserved base; no new failing test remains. See `tests.json` for exact baseline failures.
- Consolidated regression: 144 tests across 13 files passed; strict TypeScript, changed-file ESLint and Deno checks for both Edge handlers passed.
- Optimized Next.js webpack build passed. Both local baseline and candidate used webpack because this workspace uses a shared node_modules symlink; the production platform performs its own build.
- Final broad review found three integration defects, all corrected together and accepted by the single scoped re-review. Reports are archived here.

## Browser acceptance

Chromium and WebKit, light/dark and 1600/1024/390 layouts:
- Conversation identity, linked lead, group invitation/tag behavior, properties action, search and existing drafts/input node preserved.
- Product menus in actual board focus traps and mobile Chats drawers allow typing, Arrow/Enter, menu-only Escape and trigger focus return. Popup hit testing and screenshots confirm they remain inside the viewport and above panel content.
- Board at 900/768 retains conversation width and keyboard drawer focus return. Cross-funnel confirmation keeps the exact approved title; browsing/cancel writes nothing.
- Property section toggles issue no extra property/history reads. Simulated property/note save failures retain the text; requests are intercepted and no WhatsApp message is sent.
- The reported internal note appears identically in Chats and board; opening the board reuses the one loaded history response. Browser-only pagination fixture renders 60 unique notes with two reads and preserves scroll anchor.
- Quote preview works with the original deliberately removed from the loaded page, in both engines.

Baseline observation: WebKit mouse clicks do not necessarily focus the parent drawer opener, so closing can restore the previously focused trap container. The unchanged base reproduces the same behavior. Keyboard-open/Escape correctly restores the opener in the candidate. This is not reported as a new selector regression.

## Performance and operations

Performance uses the unchanged browser harness: 10 fresh contexts, 10 returns between two conversations, 1600×1000, requests/bytes captured for 10 seconds after selection. Median, p90 and maximum are retained, including cold startup outliers. Local and production measurements are separate. Results, all 10+10 runs retained:

| Sample | Cold p50 / p90 / max (ms) | Return p50 / p90 / max (ms) | Cold data p50 | Cold fetch/XHR p50 |
| --- | ---: | ---: | ---: | ---: |
| Original base measurement | 1494 / 1611 / 1631 | 41 / 56 / 121 | 67602 B | 58 |
| Candidate | 1149 / 2325 / 4169 | 142 / 168 / 936 | 65941 B | 57 |
| Base repeated immediately after candidate | 1493 / 2169 / 2243 | 89 / 270 / 1057 | 61823 B | 55 |

The initial comparison missed the latency gate. A contemporaneous repeat of the unchanged base was therefore run with the exact same harness. This demonstrated substantial ambient variance: the base's warm-up also reproduced a full initial-data reload (3519ms / 233239B), matching the kind of reload seen in the candidate's 4169ms peak. Both observations remain in raw evidence; the warm-up is labeled separately by the unchanged harness.

Against that immediately repeated base, candidate p90 satisfies cold ≤ base×1.1+100ms and return ≤ base+20ms. Candidate return median is **53ms higher**; this is disclosed, not described as a universal speed improvement. Cold median data differs by +4118B and return median by +788B, within the 10KiB investigation budget. Fetch/XHR medians differ by +2 cold/+1 return; endpoint accounting shows existing route prefetch, polling/avatar timing and the isolated bootstrap reload, with no added chat-opening query path. Initial base measurements also have those existing request categories. Route regression tests confirm identical message-read DB calls with and without quotes. No stable new data-loading fan-out was identified.

These are small samples on a shared workstation, not an isolated CPU benchmark or a guarantee about every user's latency. Production 10+10 verification will be recorded separately after publication.

No schema migration, RLS change, dependency addition or staging deployment is part of this release. Production publication and the one-record quote repair follow only after browser and performance acceptance. The original webhook envelope is unavailable; the provider's stored record and the parser mismatch support the specific quote correction.

Review screenshots and browser data containing customer content remain local, outside the repository. Temporary verification sessions are individually revoked at the end.
