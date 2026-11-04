# Reader empty date results implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. The primary agent implements the change and requests one independent review.

**Goal:** Help readers continue from an empty date selection while preserving their other filters, and hide pagination for zero results.

**Architecture:** Reuse the existing public articles HTTP endpoint. Only an empty, date-filtered result needs an additional first-page query without dates; its latest article supplies a Beijing calendar date. No backend contract or database changes are needed.

**Tech Stack:** React 19, React Router, TypeScript, Playwright Chromium/WebKit.

**Spec:** The user-approved interaction in this chat: clear only dates, offer the latest matching article date, reopen the existing date picker, and hide the zero-result pagination footer.

## Global constraints

- Preserve category, topic, source, keyword and page size; reset page when changing dates.
- Use the public API and its visibility checks; derive dates from `timelineAt` in `Asia/Shanghai`.
- Keep an optional suggestion failure from replacing a successful empty result with an error page; retain request cancellation.
- Check desktop layouts and keyboard use. Build and run browser tests in a temporary source snapshot because an existing server uses this checkout's build directory.
- No commits, service changes, or real database writes are authorized.

## Review focus

- Single-day, start-only, end-only and closed date ranges receive accurate empty-state copy.
- Other filters also having no matches must not produce a fabricated recent-date link.
- Supplementary lookup failures leave the date-clearing action available.
- Recent-date navigation uses the Shanghai day, including missing publication timestamps.
- Nonempty and undated results do not incur the additional lookup.

## Task 1: Empty-state recovery and regression coverage

**Files:** `apps/web/app/features/feed/{reader.server.ts,ReaderPage.tsx,ReaderFilters.tsx,ReaderDatePicker.tsx,ReaderNavigation.tsx}`, `apps/web/tests/reader-public.test.ts`, `README.md`.

- [x] Add browser regression cases for date clearing, matching recent dates, cancellation/reselection, zero-result pagination, no matches and lookup failures; update the prior zero-result pagination assertion.
- [x] Run the new tests against the existing build in the isolated snapshot and confirm the missing recovery UI fails.
- [x] Add `latestArticleDate: string | null` to web loader data; query the existing list endpoint only for empty date-filtered results, without dates/page and with the minimum supported page size.
- [x] Add contextual empty-state text, a date-clearing link, a link applying the suggested day to both date bounds, and a button opening the existing toolbar date picker through its trigger ref.
- [x] Render pagination only when the result total is positive; update the README's list behavior description.
- [x] Run type checking, the public-reader browser tests, and a web build in isolation. Inspect desktop screenshots, mouse/keyboard behavior and the final diff; request one read-only review.

## Verification record

- `npm run typecheck` passed using the existing Node 24.22.1 toolchain.
- `npm run build -w @agidawn/web` passed in the temporary source snapshot; the running site's build directory was not overwritten.
- The four new Chromium/WebKit cases failed on the original implementation and passed after implementation.
- The final isolated run of `node --test --test-concurrency=1 apps/web/tests/reader-public.test.ts apps/web/tests/page-width.test.ts apps/web/tests/navigation-performance.test.ts` passed all 56 tests. An earlier run had a WebKit first-click timeout in `date drafts validate after editing, normalize input and retain keyboard navigation`; the unchanged baseline, a focused rerun and the final full run passed. No unrelated date-picker change was made based on that intermittent failure.
- Desktop light/dark screenshots, effective desktop viewport widths from 1920 down to 720 CSS pixels, date-picker mouse/keyboard access and navigation during a pending supplementary lookup were checked with synthetic APIs.
- One independent read-only review found no actionable issues in the specified change. The final button uses the existing `accent-contrast` token for theme-dependent text contrast.
- No database, API contract, running service or dependency changes were required.
