# Personal board filters

Scope: staging only. Each user stores an independent period and general filter default for each board. Existing organization status is a fallback only; the board header no longer changes it.

Period presets: today, yesterday, last 7/30 calendar days including today, previous/current calendar month, custom inclusive dates, or no date limit. Relative presets resolve again on opening and while the page stays open. Creation and closure can be selected independently; when both are selected, AND is the default and OR is available with explicit labels. Closure requires an actually won/lost deal and a closure date. General filters continue to intersect with the date result.

General default includes status, product ID, owner, tag, custom field conditions and their logic. Search text is transient. Pins save explicit choices, independently; changing a filter without pinning does not change the default. Unpinning removes that group's saved preference. URL status overrides saved status, and manual changes override both during the visit.

Implementation and validation:
- Pure date/product helpers with calendar, boundary, AND/OR and missing-date tests.
- Per-user/board table with ownership and board-visibility RLS; authenticated API validates date payloads and organization context.
- Scoped React Query state; separate drafts; reset on user, organization or board change; tests cover late responses and reopening.
- Period panel with presets, date field selection, validation and independent pin controls; product selector and whole-general-filter pin in the existing filter panel.
- Apply filters consistently to active/inactive leads and kanban/list views.
- Test API authorization, cross-user database isolation and independent persistence; run typecheck, scoped lint and production build before staging publication.
- Do not publish to main or apply the migration to production.
