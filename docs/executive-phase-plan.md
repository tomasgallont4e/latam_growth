# Executive spec by implementation phases

**Status.** The first portion of Phase 1 is implemented and verified on `feat/executive-spec-phases`. The source of truth for requirements remains `think4ever-tablero-286-spec-executive-equipo-28oct (1).pdf`; this plan tracks implementation against it.

**Verified baseline.** `origin/main` is `9efa503856e3069bb7a1a67eff700d786664c297`. The checkout was clean when the phase branch was created from that commit. `npm test` passed 96 of 96 tests before changes. The live UI already has the Executive route, monthly API, five KPI cards, chart, country table, funnel and What changed block. The current local suite passes 98 of 98 tests. These tests do not validate the running production UI.

## Definition of done

Every applicable item in source PDF §6 has a real source or an explicit `No data yet`/`Under review` state, tests cover measured zero versus missing data, and the live Executive view meets layout and mobile requirements. Research can reproduce the sign-up number and complete a source reconciliation. The view is not presented outside the team until that validation is complete. No commit to `main`, deployment, external sharing, or data deletion is part of this work unless separately requested.

## Phase plan

| Phase | Scope and dependencies | Verification gate | State |
|---|---|---|---|
| 0. Baseline and contract | Pin source PDF and current `origin/main`; preserve the existing accounts-versus-registration distinction, Bogotá cutoff, missing-data semantics, and confirmed GA4 host decision. | Clean baseline, source-to-screen trace, existing suite result recorded. | Done for this run. |
| 1. Close visible spec gaps | Compare the existing view with §§3.1–3.9 and §6. Implement the smallest independent fixes for default entry, cutoff visibility, month options, mobile layout, and required caveat/labels. Do not change data-source semantics in this phase. | Focused UI tests, full test suite, JS syntax checks, local browser/DOM verification at desktop and 375 px. | Executive default, mobile KPI carousel, chart source label, proposal tag on the goal line, and no-zero Top 5 rows are implemented and covered. Live visual verification is blocked until an approved browser session is available. Re-audit remaining criteria before calling Phase 1 complete. |
| 2. Data-source and metric contract | Verify PostHog first-identify host/country/internal coverage and GA4 go-host metrics. Resolve internal/test identities without guessing domains. Trace channel reporting and `loaded`/`no campaigns`/`pending`; never call inaccessible Meta or LinkedIn zero. | Connector tests and successful real-source coverage snapshots. Unknown coverage stays pending. | Not started. |
| 3. Complete API calculations | Cover month totals, since-launch totals, target pace/projection, paid completeness and currency, visit rate, top five, four-step funnel, and deterministic What changed. Add or update `exec_flag|<element_id>` review state and `exec_note|YYYY-MM-DD` notes where required. | Per-contract unit tests for full/partial/no coverage, true zero, month boundaries, and every formula. API smoke with synthetic isolated data. | Not started. |
| 4. Executive presentation and responsive behavior | Finish English source labels, reasons, Under review states, proposal badges, no-data wording, chart controls, and mobile stacking. Keep other views and shared filters unchanged. | Render against real-like data, inspect desktop and 375 px browser DOM/screenshots, no horizontal page overflow or console errors. | Mobile carousel CSS was verified in an isolated fixture. Full Executive browser sign-off and cloud integration remain open. |
| 5. Reconciliation and release gate | Compare Executive accounts with the portal database and paid data with the platform reports. Research completes the validation sheet, records mismatches as Under review, and approves release scope. | Signed-off source values, filled validation sheet, all applicable acceptance criteria checked. Keep anything unverified within the team. | Blocked on source owners and Research. |

## Audit notes from the first pass

- `origin/main` contains a live Executive entry in `public/index.html`, a view module in `public/js/views/executive.js`, a month endpoint in `server.js`, and the calculations in `lib/executive.js` / `lib/executiveView.js`.
- The endpoint uses dedicated PostHog `ph_exec_accounts` facts and GA4 `ga_exec_geo_sessions`; the current dashboard's standard metrics remain separate. Do not rename `ph_accounts`, `ph_signups`, or `ph_new_persons` in this work without a specific verified migration.
- `public/js/app.js` chooses the tab from the URL hash first, then the saved `t4e-growth-tab` if it is not `overview`, then `executive`. The regression test confirms that a new visit and a saved `overview` open Executive, while a different saved tab or explicit URL remains respected.
- The existing KPI card renders an `Under review` indicator, and the view reads a recent Research note. The backend also distinguishes pending paid sources. Verify each against the exact §6 criteria before marking the feature complete.
- The Executive goal chart carries the stored target’s proposal status to its SVG label and names PostHog sign-ups and monthly Targets as the chart sources. The Top 5 card names PostHog sign-ups and GA4 sessions, and its view omits rows where both are zero. API-to-view tests check these strings in rendered HTML. The full local suite passes 98 of 98 tests.
- The local mobile-carousel fixture produced a 375 px page width and a horizontally scrollable KPI row. The full-page screenshot attempt timed out. An attempt to use the active Brave window required input approval and timed out. No browser input was retried, and the running app was not changed.
- The Think4Ever workspace contains Executive view logic not present in `origin/main`, including stale-day and Under review rendering. Its `executive.js` contains `goalLabel` wiring but not the local chart source note. The workspace was not changed. The cloud health check returned a login redirect.

- The PDF requires LinkedIn paid reporting and currency validation. Local code keeps LinkedIn paid reporting pending. The runtime does not expose `INTERNAL_DOMAINS`; no MoadBus domain or tester identity is known. No access, account, currency, or internal classification was guessed or changed.
- The running Think4Ever service is published. No deploy or cloud write was performed.

## Source references

- Requirements and acceptance: source PDF §§1–8, especially §§3.1–3.9, 6, 7, and 8.
- Live UI: `public/index.html`, `public/js/app.js`, `public/js/router.js`, `public/js/views/executive.js`, `public/css/app.css`.
- API and calculations: `server.js`, `lib/executive.js`, `lib/executiveView.js`.
- Connector evidence and tests: `lib/connectors.js`, `test/executive.test.js`, `test/paid-metrics.test.js`.
- Baseline: `origin/main` at `9efa503856e3069bb7a1a67eff700d786664c297`; `npm test` passed 96/96 before Phase 1.

## Next review

1. Review remaining §6 acceptance criteria and verify the live browser under an approved session.
2. Start Phase 2 only for source work whose semantics the repository or existing decisions already establish. Keep unresolved access and business classifications pending for their owners.
3. Compare the local phase branch with the Think4Ever workspace before any merge or deployment. The workspace is ahead of `origin/main` in Executive UI behavior and must not be overwritten blindly.
4. Update this file with each verified result and blocker. Do not edit the source PDF.
