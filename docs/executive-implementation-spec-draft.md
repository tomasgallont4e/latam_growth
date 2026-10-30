# Executive tab — implementation spec (working draft)

**Status:** Working implementation spec; the first backend data slice is in progress on `feat/executive-tab-v1`. Use alongside `Downloads/think4ever-tablero-286-spec-executive-equipo-28oct.pdf`; the PDF remains the detailed design source for sections 3.1–3.9. This file records findings, confirmed definitions, implementation gaps, dependencies, and the review plan.

**Code baseline reviewed:** `origin/main` at `022cf7d` (PR #9 merge). `npm test`: 66 passing.

## 1. Purpose and guardrails

Build the Executive view for business owners and Direction, with exact numbers, visible source/cutoff, and short explanations. Keep the interface in English, use `America/Bogota`, and use the last full synchronized day as the cutoff. Missing/incomplete sources must show `No data yet` with a reason, never a fabricated zero. Internal/test exclusion is always on for this view. See PDF §§1–3, 6.

Detailed layout, formulas, and acceptance criteria remain in the source PDF. This draft records clarifications that affect implementation.

## 2. Metric contract: PostHog accounts and country

### Confirmed dashboard definition

- The active LATAM Growth dashboard counts an account as the person's **first `$identify`**, once per person (`ph_accounts`; code: `lib/connectors.js`, `public/js/app.js`, `docs/posthog-funnels.md`).
- `registration_started` is a preceding intent step, not an account. In current main its normalized metric key is `ph_signups`; do not reuse that key for accounts. `ph_new_persons` is observed new people, not verified accounts.
- A separate `account_created` event is documented and appears in another funnel definition, but this repository does not prove that the portal currently emits it after a successful database commit. Treat it as **unverified**, not as the current account-count source. PostHog `identify` can be called at login as well as signup, so first identify is the dashboard's operational proxy, not transaction-level proof.

### PostHog UI evidence reviewed

- Trends: `Identify` → `Unique users`, last 30 days, grouped by day, internal/test exclusion enabled.
- A query for `Country code is not set` returned no matching results in that selected window. This supports that no missing-country Identify events were observed in that query; it does not prove coverage for all history or all unfiltered hosts.
- A host-filtered view for `portal.think4ever.com` showed a country-name breakdown with multiple countries.
- A broader Host breakdown showed `portal.think4ever.com` plus `cell-ssm-use1-0006.us.portal.think4ever.com` and `cell-ssm-use1-0008.us.portal.think4ever.com`. A later Host selector autocomplete (`Suggested values · last 7 days`) also listed `cell-ssm-use1-0005.us.portal.think4ever.com` and other regional cell hosts. These suggestions are candidates to classify, not proof that every listed host is a production account host; do not silently add them to the official-host allowlist.
- The attached Excel export has person identifiers and `created_at`, but no country, host, or event columns. No individual names, emails, or IDs are copied into this spec.

### Implementation requirement / gap

- For account geography, use the country attached to the **first qualifying `$identify` event** (event GeoIP country code/name) or a verified explicit person `country` property. Do not substitute a latest-location property for signup-time geography without approval.
- Restrict account `$identify` to the approved production host allowlist and exclude internal/test accounts. The PDF lists `portal.think4ever.com`, `think4ever.com`, and `www.think4ever.com`; it excludes `t4e-pi.vercel.app` and `preciolider.com.ar`. Classify the observed `cell-ssm-…us.portal…` hosts before finalizing the allowlist.
- Current `lib/connectors.js` account query reads `person.properties.country` or `person.properties.$geoip_country` and does not visibly apply the same host restriction used for `registration_started`. It should be aligned to the verified property key and host allowlist. The `account_coverage.country_available` flag should reflect actual country-bearing account rows, not merely successful execution of the account query.
- Acceptance: with the agreed hosts and internal/test filter, the number of first-identify accounts missing country is reported explicitly; country coverage is never inferred from the presence of a GeoIP property name in the schema alone.

## 3. GA4 domain and country review

### Current main status

- Daily GA4 country metrics already exist as `ga_geo_sessions` (plus users/engaged sessions), queried by `date` and `country` in `lib/connectors.js` and consumed by country views.
- The GA4 `run` helper applies `hostName IN SITE_HOSTS` (defaults include `think4ever.com`, `www.think4ever.com`, `go.think4ever.com`, and `portal.think4ever.com`), but `hostName` is not returned as a dimension. Thus shared `ga_geo_sessions` can aggregate across allowed hosts; it is not a `go`-only metric.

### Verification plan

1. Use the confirmed `Landing LATAM` stream (`https://go.think4ever.com`) for the Executive landing-session denominator. The user chose **go.think4ever.com only**; do not combine root-domain sessions unless it is later verified and explicitly added.
2. Keep the configured cross-domain list as reference only; it does not establish event coverage for the other hosts.
3. In **Explore → Free form**, use `Hostname`, `Date`, `Country` and `Sessions` to validate `go.think4ever.com` and check future changes.
4. Create an Executive-specific GA4 report/metric filtered to `hostName = go.think4ever.com` (or parameterize the report) so the Executive denominator is go-only. Preserve the broader shared `SITE_HOSTS` filter for existing dashboard screens; do not silently narrow it globally or double-count a duplicate metric.

**Review result (from the screenshots):**

- Web stream `Landing LATAM` is active; Stream URL is `https://go.think4ever.com` and its Measurement ID is `G-B1HW840KBC`.
- Cross-domain settings list `go.think4ever.com`, `portal.think4ever.com`, and `think4ever.com`, each with match type `Contains`. This is configuration evidence, not proof that each host currently sends events.
- The Free form exploration uses **Hostname**, **Date**, and **Country** dimensions, with **Sessions** as the metric; Device category remains as a column dimension. The query for `go.think4ever.com` returned country/day rows (including Colombia, United States, Bangladesh, and Canada), confirming daily sessions-by-country data for that host in the displayed period.
- An explicit filter `Hostname exactly matches think4ever.com` for **Last 28 days (Oct 2–29, 2026)** returns **no data**. Tag Assistant for the root domain in Chrome Incognito timed out and detected **0 Google tags**; the earlier `/latam` URL on the root returned 404. Root-domain sessions therefore remain unverified and are **excluded from the Executive denominator by user decision**.
- The user confirmed that Executive should use **`go.think4ever.com` only** for landing sessions. GA4 Realtime shows `/latam` activity but not Hostname; the Explore query for `go.think4ever.com` returned daily session rows by country. This is sufficient for the v1 source choice, with the connector host filter still required.

## 4. Paid channel status and access

### Required status model

For each paid channel, return one of:

- `loaded`: the correct account was queried successfully; include `last_successful_sync` and covered-through date.
- `no campaigns`: the correct account was queried successfully and confirms no campaigns/delivery in the selected period.
- `pending`: access, API approval, connector, or report is unavailable/failed; include reason and last attempt.

`pending` is never a measured zero. If an active paid channel is pending, do not publish a complete spend total or blended cost-per-sign-up as if complete.

### Meta

**Blocked by advertiser access.** The paid T4E account has not been shared with the dashboard portfolio. Keep `Meta: pending — ad-account access not granted`; do not show `$0`. Set `META_AD_ACCOUNT_ID` only after the correct account is shared and assigned to the service user. Owner/dependency: Publicidad/account owner.

### LinkedIn Ads

- User suspects no campaigns have launched; treat as unverified until Campaign Manager is checked for the actual ad account and period.
- Current main's LinkedIn connector is for organic Page analytics; no paid `li_ad_spend`/`li_ad_impressions` reporting connector is present. A token alone does not implement paid reporting.
- Paid reporting path: approved LinkedIn Developer app with Advertising API access and `r_ads_reporting`, plus OAuth authorization by a member with the appropriate ad-account role. The Campaign Manager **Signals Manager → Direct API** token is for Conversions API, not general Ads reporting.
- If the reporting API can access the account and confirms no campaigns, mark `no campaigns`; otherwise mark `pending` with the exact reason.

## 5. Current-main implementation audit

| Spec item | Current main status | Work still needed |
|---|---|---|
| PostHog accounts | `ph_accounts` uses first `$identify`; `ph_signups` is `registration_started`. | Align event GeoIP key and official-host filter; verify whether `account_created` is emitted by the portal. |
| GA4 country sessions | Daily `ga_geo_sessions` is implemented (`date` + `country`) under the shared `SITE_HOSTS` allowlist. | Add an Executive-specific `hostName = go.think4ever.com` report/metric; root domain excluded per user decision without changing other screens. |
| Executive API | `/api/executive` and `lib/executive.js` exist, plus `/executive` sample prototype. | It is not an integrated live tab in `public/index.html`; endpoint does not honor `?month=YYYY-MM`; prototype maps `platform_signups` from `ph_new_persons`, not canonical `ph_accounts`. |
| Generic source `pending` | Implemented at source level with a note. | Per-paid-channel `loaded / no campaigns / pending` model is not implemented. |
| LinkedIn paid Ads | Not implemented; current connector is organic Page analytics. | Add reporting connector only if the spec requires automated paid reporting and API access is approved. |
| Meta paid Ads | Connector exists, but correct account access is blocked. | Wait for account share; preserve `pending` state. |

## 6. Guti (datos): work allocation from source spec §7

1. Implement/confirm first-identify account metric with hosts, internal filters, and country; use current `ph_accounts` naming unless a deliberate migration is specified.
2. Confirm/maintain daily `ga_geo_sessions` country report; validate GA4 hostname coverage and add host dimension only as required.
3. Complete `api/executive` calculations for sections 3.1–3.9, using verified metric keys and returning explicit no-data reasons.
4. Add per-channel paid-source state, last successful sync, and reason.
5. Resolve currencies before combining spend; LinkedIn spend may be local currency.
6. Confirm internal domains/testers. The export suggests `moadbus.com` and `moadbusglobal.com` as candidate business domains; validate before excluding. Do not exclude all Gmail users—use a confirmed tester list.
7. Confirm whether the LinkedIn Ads patch/reporting access exists; organic Page connection is not proof of paid Ads access.
8. Change `META_AD_ACCOUNT_ID` only after the T4E paid-ad account is shared.

### Dependencies / reviewers

- **Publicidad/account owner:** share Meta paid account; confirm ad-account currencies; provide MoadBus/tester classification.
- **Tomás (front/product):** clarify whether the landing form creates a portal account or only a HubSpot lead; run the portal-database account-count cross-check; integrate Executive UI.
- **Research:** validation sheet, acceptance checks, under-review flags, and approval before the view leaves the team.
- **Dirección:** approve proposed monthly goal ramp where required.

Deadlines in the 28-Oct PDF are retained as source history only; confirm they remain current before using them as a schedule.

## 7. Execution plan and review sequence

### Implementation order

1. **Lock the data contracts:** GA4 landing sessions use `go.think4ever.com` only (confirmed by the user); PostHog account counts retain first `$identify` as the current dashboard proxy, with `registration_started` kept separate. Resolve the PostHog host allowlist, GeoIP event key, and internal/test rules before claiming complete account coverage.
2. **Guti — connectors/data:** add an Executive-specific GA4 daily report filtered to `hostName = go.think4ever.com` while preserving shared `SITE_HOSTS` reports; correct the PostHog account query to use the verified event GeoIP key and official host allowlist; make `country_available` reflect actual country rows; add the per-paid-channel status object.
3. **Guti — API:** adapt `/api/executive` to the month-filtered §3.1–3.9 contract, use `ph_accounts` for accounts (not `ph_new_persons`), and return explicit reasons for missing/pending data. Keep Meta spend/CPS unavailable while access is blocked.
4. **Tomás — frontend:** integrate the Executive page into the live navigation, consume the API, and render the approved empty/under-review/channel states and mobile layout.
5. **Research — validation:** reconcile account totals with the portal query, complete the two-source validation sheet, run acceptance tests, and mark mismatches `Under review` before the page is shared outside the team.

### Review status / remaining gates

- [x] PostHog: Identify unique-user trend, country breakdown, missing-country filter, and `portal.think4ever.com` query reviewed for the selected period.
- [ ] PostHog: classify observed `cell-ssm-…portal…` hosts (including `use1-0005`, `use1-0006`, and `use1-0008`); confirm exact GeoIP event-property key and whether `account_created` is emitted after persistence.
- [x] GA4: stream and domain configuration reviewed; user chose `go.think4ever.com` as the only landing-session source for v1. Root `think4ever.com` is not included until tag/data is verified.
- [ ] LinkedIn: verify campaign status in Campaign Manager, account currency, account role, and Advertising API access if paid reporting is needed. No paid reporting connector exists in main.
- [ ] Publicidad: confirm MoadBus domains/testers and currencies; share Meta paid account. Meta remains `pending` until access is granted.
- [ ] Finalize endpoint schema and acceptance matrix, then implement and test the live Executive view.

## 8. References

- Source design: `Downloads/think4ever-tablero-286-spec-executive-equipo-28oct.pdf`, especially §§2, 3.1–3.9, 4–7.
- Main source paths: `lib/connectors.js`, `lib/executive.js`, `server.js`, `public/index.html`, `public/js/views/sources.js`, `docs/posthog-funnels.md`, `docs/utm-measurement.md`.
- PostHog identify: https://posthog.com/docs/product-analytics/identify
- PostHog person/GeoIP properties: https://posthog.com/docs/product-analytics/person-properties
- PostHog event capture: https://posthog.com/docs/product-analytics/capture-events
- GA4 cross-domain measurement: https://support.google.com/analytics/answer/10071811
- GA4 Data API dimensions/metrics: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- LinkedIn Marketing API access/scopes: https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-09
- LinkedIn ad-account roles: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/account-access-controls?view=li-lms-2026-08
- LinkedIn Advertising API quick start: https://learn.microsoft.com/en-us/linkedin/marketing/quick-start?view=li-lms-2026-09
- LinkedIn Campaign Manager Direct API token scope: https://learn.microsoft.com/linkedin/marketing/conversions/getting-access-conversions?view=li-lms-2026-02
