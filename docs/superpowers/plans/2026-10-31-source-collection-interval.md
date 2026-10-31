# Twelve-hour source collection

**Goal:** Default to one collection every 720 minutes and apply it to the eleven configured sources.

**Approach:** Reuse each source's existing interval and next-fetch timestamp. Remove automatic interval adaptation so it cannot overwrite the configured value. Keep minute-by-minute due checks, content processing, translation, and provider budgets.

- [x] Add regression coverage for source defaults, long-interval failures, retired adaptation schedules, and normal quiet periods. Four assertions failed before the change; all 23 targeted tests now pass.
- [x] Use `SOURCE_DEFAULTS.intervalMinutes` in source creation, the admin form, and seeding; update the eleven-source configuration and add one online migration for the database default.
- [x] Remove interval adaptation, keep failed fetches from running sooner than the configured interval, and allow 24 hours without new content before alerting.
- [x] Update operational documentation and the environment example; typechecking, all 611 backend tests, the web build, all 97 web tests, and smoke checks passed. An initial WebKit topic-overlay timeout passed both an isolated rerun and the complete web rerun.
- [x] Apply the migration, update only the eleven configured sources and their next-fetch times, restart affected services, and verify live settings and schedule removal. All eleven sources remain enabled and healthy; next fetches are 2026-11-01 09:11–09:43 Asia/Shanghai. Audit records retain each change; source fields outside the interval and scheduling timestamps were verified unchanged.

Existing source permissions, cursors, articles, and private reader data remain intact. Existing sources are updated explicitly rather than by a data-changing release migration. Source intervals remain editable in the admin UI.
