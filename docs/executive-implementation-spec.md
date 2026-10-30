# Executive tab — implementation specification v1

**Status:** Implementation in progress. This spec consolidates the authoritative design in `Downloads/think4ever-tablero-286-spec-executive-equipo-28oct.pdf` with verified decisions. The PDF remains the source for detailed layout and formulas in §§3.1–3.9; this file is the implementation contract and marks unresolved items explicitly.

**Code baseline:** `origin/main` at `022cf7d` (PR #9 merge). Implementation branch: `feat/executive-tab-v1` (local, not merged or pushed). Current feature-branch suite: **81 passing**.

## 1. Goal, audience, and global rules

Build a live **Executive** tab for the business owner and Direction. It should answer: monthly progress to goal; sign-ups this month and since launch; paid spend and blended cost per sign-up; where the funnel loses volume; country performance; and what changed recently.

- Interface language: English. Date/time: `America/Bogota`.
- Month selector only; default to the current month. The data cutoff is the last full synchronized day; the current incomplete day is excluded.
- Start at `LAUNCH_DATE = 2026-10-01`. Always exclude internal/test accounts; no user-facing internal switch.
- Missing or incomplete data is `No data yet` plus a reason, never a fabricated zero. A zero is valid only after a successful source query confirms zero.
- Keep the page within the existing LATAM Growth visual system. Integrate it into the live dashboard navigation; `/executive` sample prototype is not the live page.

## 2. Metric/source contract

### Sign-ups and accounts (PostHog)

- **Dashboard account definition:** first `$identify` per person, counted once, stored in main as `ph_accounts`. This is the current operational proxy, not proof that the account database transaction succeeded.
- `registration_started` remains the prior intent step and is stored as `ph_signups`; it is not an account. `ph_new_persons` is not a verified signup metric. Do not overload or rename these keys.
- `account_created` is a desirable backend confirmation after persistence, but production emission is not verified. Do not use it as the count until Product confirms it is emitted after successful account creation and the event is verified in PostHog.
- Apply the approved production host allowlist and internal/test filters to the account query. The PDF allowlist is `portal.think4ever.com`, `think4ever.com`, `www.think4ever.com`; exclude `t4e-pi.vercel.app` and `preciolider.com.ar`. Cell hosts such as `cell-ssm-use1-0005/0006/0008.us.portal.think4ever.com` are **unclassified** and must not be silently included.
- Country for an account should come from the verified country property on the qualifying first `$identify` event (`$geoip_country_code`/`$geoip_country_name`) or a verified explicit person `country` field. Do not substitute latest-location country for signup-time country without approval. Set coverage from actual country-bearing account rows, not query success.
- PostHog Trends confirmed `Identify` with `Unique users` and a 30-day range; the breakdown label explicitly reads **event's Country name** and returns country rows. This proves event-level country values exist for some matching Identify events in that observed window, not that every account is geocoded or that this is a persistent person property.
- Feature-branch connector now reads `properties.$geoip_country_name` on each person's earliest `$identify` and emits Executive-only `ph_exec_accounts` / `ph_exec_accounts_geo`. It uses the PDF's exact-host allowlist; unclassified `cell-ssm…` hosts are excluded from certified counts and exposed as aggregate coverage warnings. A real PostHog sync is still required to validate this query against the project.

### GA4 landing sessions and countries

- **User decision:** Executive v1 uses only `go.think4ever.com` as the landing-session source. `think4ever.com` is excluded until its tag/data is independently verified.
- GA4 stream `Landing LATAM` is `https://go.think4ever.com`, Measurement ID `G-B1HW840KBC`.
- Main already ingests daily `ga_geo_sessions` by `date` and `country`, but the shared query applies `hostName IN SITE_HOSTS` (`think4ever.com`, `www.think4ever.com`, `go.think4ever.com`, `portal.think4ever.com`) and does not return hostname as a dimension. Do **not** narrow this shared query globally, since existing screens rely on the broader site allowlist.
- Add an Executive-specific GA4 report/metric filtered to `hostName = go.think4ever.com`, returning daily sessions and country rows. Reuse GA4's supported date/country dimensions; do not sum users across days.
- Root-domain evidence: exact Hostname filter on `think4ever.com` returned no data for Oct 2–29, 2026; Tag Assistant on `think4ever.com/` in Chrome Incognito timed out with 0 tags; `think4ever.com/latam` returned 404. Realtime showed `/latam` but not the hostname. These observations do not establish whether the root has no traffic or lacks a tag; the v1 source decision is to use `go` only.

### Paid channels and data completeness

For each channel return `loaded`, `no campaigns`, or `pending`, plus last successful sync/covered-through date and a human-readable reason.

- `no campaigns` only after an authenticated query to the correct account succeeds and confirms no campaigns/delivery in the selected period.
- `pending` is never zero. If a channel with active campaigns is pending, aggregate spend/CPS is unavailable, not partial or fabricated.
- **Meta:** blocked until the T4E paid-ad account is shared with the dashboard portfolio and service user. Record `pending — ad-account access not granted`; do not show `$0` or CPS. Update `META_AD_ACCOUNT_ID` only after sharing.
- **LinkedIn:** main has organic Page analytics but no paid Ads reporting connector. The user suspects no campaigns, unverified. If reporting is needed, require approved LinkedIn Advertising API app access with `r_ads_reporting` and a member with the correct ad-account role. The Campaign Manager Signals Manager Direct API token is for Conversions API, not reporting. Check account currency before combining spend; do not sum unlike currencies.
- **Google Ads:** retain the source status and distinguish verified `no campaigns` from a connector failure.

## 3. Executive layout and calculations

Follow the source PDF §§3.1–3.9 without changing its formulas silently:

1. Five KPI cards: sign-ups this month; sign-ups since launch; paid spend this month; blended cost per sign-up; visit-to-sign-up rate.
2. Full-width monthly sign-ups vs goal chart.
3. Two-column Top 5 countries and four-step paid funnel.
4. Full-width “What changed” with three rule-generated phrases; optional short Research note.

Key rules:

- Sign-ups this month = external first-identify accounts in the selected month through cutoff, using the approved host list and country mapping. Since-launch count is cumulative through the selected month end.
- October has no goal. November/December goals are proposals pending Direction approval; never hard-code target values.
- Projection only from day 7 onward; pace from Actual vs Minimum-to-date. Growth percentages only when comparison base is at least 30; otherwise show absolute difference.
- Blended CPS = complete paid spend / external LATAM sign-ups. Do not attribute sign-ups to a paid channel without verified attribution.
- Funnel steps are paid impressions → landing sessions → form start → external sign-up. Missing steps stay `No data yet`; rates are indicative across sources and not linked-person conversion. Mark the biggest drop only among steps with data.
- “What changed” is deterministic rules, not generated causal claims. Sign-ups phrase first; compare only complete weeks; use percentages only with base ≥30; no invented causes.

## 4. API and data contract

- The branch now accepts `GET /api/executive?month=YYYY-MM`, validates real calendar months, slices daily series to the selected month, derives a Bogota cutoff from successful GA4/PostHog coverage and yesterday, and returns month totals plus since-launch sign-ups. Without successful source coverage, cutoff and totals stay null rather than displaying zero.
- The old no-month route remains full-range for the standalone `/executive` sample. The API is still partial: cards/funnel/Top 5/“What changed” and per-paid-channel states/currency are not yet assembled into the v1 response; the active `public/index.html` still has no Executive nav or live view.
- Preserve separate metric keys for Executive-only GA4 go-host reports; do not silently change shared GA4 metrics consumed by existing tabs.
- Each response field must have an explicit no-data/source status so incomplete Meta or LinkedIn data cannot appear as zero.

## 5. Implementation progress (feature branch)

- PostHog now emits Executive-only first-identify external totals (`ph_exec_accounts`) and country rows (`ph_exec_accounts_geo`) from event GeoIP, with exact allowed hosts and aggregate excluded-host/country coverage. Existing `ph_accounts`/`ph_accounts_geo` semantics remain unchanged.
- GA4’s `go.think4ever.com` report remains separate from shared host metrics. The builder consumes it, and now maps the new PostHog metrics to country/unsplit totals while marking unclassified-host counts `pending`.
- `GET /api/executive?month=YYYY-MM` now validates and slices to the selected month; cutoff is limited to successful source coverage and the previous full Bogota day. The response exposes monthly and since-launch signup totals, plus coverage/targets.
- PostHog query now uses deterministic `timestamp + event uuid` ordering for first-identify attribution and refuses to certify results at the 5,000-row safety threshold or when PostHog reports more rows. The monthly API requires valid, full-window source bounds; it nulls uncovered days and totals rather than treating them as zero.
- Tests: **81/81**. Independent review passed with no security or logic errors; it recommended explicit `hasMore` and repeated-month validation coverage, now tested. An isolated HTTP smoke test returned 200 for `2026-10`, 400 for invalid `2026-13`; with no sync data it correctly returned `cutoff:null`, no days, and sign-ups pending. This was an empty scratch store, not a live GA4/PostHog sync. No commit, push, or deployment.
- Still outstanding: live PostHog sync and Product decision on excluded cell hosts; complete API composition (KPI cards, funnel, Top 5, “What changed”, per-channel status/currency); live Executive nav/view; Research reconciliation and acceptance.

## 6. Acceptance criteria

- Executive opens from the live dashboard navigation; other tabs remain unchanged.
- Data cutoff and month are visible and use Bogota dates; internal/test exclusion is fixed on.
- PostHog accounts use first `$identify` once per person, separate from `registration_started`, HubSpot leads, and observed new people.
- GA4 landing sessions are specifically filtered to `go.think4ever.com`; daily country results reconcile to the selected host/range. No root-domain data is mixed into the v1 denominator.
- Missing-country counts are visible or explicitly reported; country completeness is based on actual rows.
- Meta pending never becomes zero; spend/CPS remain unavailable while required active channels are pending. LinkedIn `no campaigns` requires a successful check of the correct account.
- Top 5 does not pad with zero countries; funnel does not invent missing steps; no names, emails, or person IDs appear in the UI.
- What-changed rules use complete comparable periods only and meet the PDF’s thresholds.
- Research can reproduce the sign-up total from the portal database and complete the two-source validation sheet before release outside the team.

## 7. Owners, dependencies, and execution order

- **Guti (data):** PostHog account/country/host query; Executive-specific GA4 go-host report; calculations/API; per-channel statuses; currency; internal/test domains; Meta ID only after access.
- **Tomás (front/product):** confirm landing-form behavior; run portal DB cross-check; integrate live frontend and mobile layout.
- **Research:** two-source validation sheet, acceptance run, under-review flags, and approval before broader sharing.
- **Publicidad/account owner:** Meta account share, ad-account currencies, MoadBus domain/tester classification.
- **Dirección:** approve proposed goal ramp.

Execution:
1. Validate the new PostHog first-identify query on a real sync; Product must classify excluded cell hosts before any are added to the approved allowlist.
2. Finish the monthly API payload with KPI cards, funnel, Top 5, “What changed,” and per-channel status/currency; retain the tested cutoff/no-zero semantics.
3. Integrate the live Executive UI in the active navigation.
4. Run live connector reconciliation, Research validation, and the PDF acceptance checks.

Meta remains a known external blocker and should be represented as `pending`, not block non-paid portions of development.

## 8. Source references

- Detailed design: `Downloads/think4ever-tablero-286-spec-executive-equipo-28oct.pdf`.
- Discovery and current-main audit: `docs/executive-implementation-spec-draft.md`.
- Handoff summary: `docs/executive-spec-handoff.md`.
- Main code: `lib/connectors.js`, `lib/executive.js`, `server.js`, `public/index.html`, `public/js/views/sources.js`, `docs/utm-measurement.md`, `docs/posthog-funnels.md`.
- GA4/PostHog/LinkedIn official references are listed in the discovery draft.
