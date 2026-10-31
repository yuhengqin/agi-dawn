# Pagination Controls Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this small frontend change. Keep the existing public API and GET navigation contract.

**Goal:** Combine GitHub-style centered page links with a Carbon-style compact control bar, retaining totals, arbitrary page jumps and 25/50/100 page sizes.

**Architecture:** Reuse ReaderPagination and the existing preserved-filter forms. Keep the list-header total; move the page-size selector into the footer with the range, total and editable current page. Native forms and links must remain usable without JavaScript. Wrap controls and page links on narrow screens.

**Tech Stack:** Existing React, React Router, Tailwind and semantic theme tokens; no new dependencies.

**Spec:** User-approved GitHub/Carbon direction and docs/reader/pagination-acceptance.md.

## Constraints and review focus

- Display every page when there are at most nine; otherwise retain the first, last and nearby pages with ellipses.
- Keep quantity selection available for empty and single-page results, even when page navigation is absent.
- Keep filters and history, reset to page one when quantity changes, and support Enter in the page field.
- Preserve keyboard focus visibility, dark-theme contrast, 320px reflow and native GET submission.
- Change only pagination UI, its existing regression test and the documentation that owns these behaviors; no API, data, service or dependency changes.

## Task: Pagination navigation and controls

- [x] Extend the existing browser regression with seven-page navigation, keyboard jump, narrow-screen page links and empty/single-page quantity selection; confirm the current implementation fails.
- [x] Update ReaderPagination.tsx, its ReaderPage.tsx call and scoped app.css rules; retain the existing form labels and URL behavior.
- [x] Run type checking, production build and affected public-reader/width tests; inspect Chrome desktop/mobile and light/dark screenshots.
- [x] Review the diff independently and update the pagination topic that owns the layout and validation facts.
