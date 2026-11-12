# Executive · Daily Landing Funnel Report

A daily report in the Executive view, placed right below "Executive funnel · 7 stages" (above "Sign-ups vs goal"). It is folded by default: the card title stays visible and the content opens when the user clicks "Open the daily report by date, channel and campaign". It stays open while the Channel/Campaign filters change and resets to folded when the user leaves Executive. It shows how traffic moves from the ad to activation, **per day × channel × campaign**, for the month picked in the global Month selector. It is read-only. It uses only rows the connectors already stored (`gd_items`). It does not call any external API, does not write anything, and does not change any connector (memory #111). It takes no action on any ad platform.

- Module: `lib/dailyFunnel.js` (pure function `build`)
- Route: `GET api/daily-funnel?month=YYYY-MM` (same login gate as the rest of `api/*`)
- View: `public/js/views/executive.js` → section "Daily Landing Funnel Report"
- Tests: `test/dailyFunnel.test.js`

## Stages

| Stage | Source | Day basis | Status today |
|-------|--------|-----------|--------------|
| Spend, impressions | Meta Ads, Google Ads (`ad_spend`, `ad_impressions`, dim campaign) | Each ad account's time zone | Loaded (Meta, Google Ads); LinkedIn Ads not connected |
| Clicks | Meta `ad_outbound_clicks` (only with `outbound_coverage`), Google Ads `ad_clicks` | Ad account time zone | Loaded |
| Landing sessions | GA4 `executive_landing_utm_N`: session source / medium / campaign on go.think4ever.com | GA4 property time zone | Loaded |
| Forms / sign-ups | HubSpot `form_signup` events, external contacts, UTM properties | **UTC** day of `createdate` | Loaded |
| Accounts created | PostHog first `$identify`, External, all hosts (`ph_accounts`). Campaign split from `identity_cohort` | PostHog project time zone | Loaded |
| Logins | PostHog `ph_event` = `signed_in` (entries to the platform). Event count, not people; returning accounts included; internal not separated; no campaign split. Shown as a column in Daily totals | PostHog project time zone | Loaded (replaces "Credits loaded") |
| Projects created | PostHog first `project_created` per person (`identity_cohort`) | PostHog project time zone | Loaded |

## Calculations (only when numerator and denominator exist)

- CPM = spend ÷ impressions × 1,000
- CPC = spend ÷ clicks
- CTR = clicks ÷ impressions
- Cost per session / form / account (matched) = ad spend ÷ the results of the same campaign (matched rows only)
- Cost per account (blended, daily totals only) = all known spend ÷ accounts created
- Conversion between stages: click → session (matched), session → form, session → account, account → project

## Attribution rules

- **Ads ↔ UTMs.** Spend, impressions and clicks join sessions, forms and accounts only when the ad campaign name equals `utm_campaign` (case-insensitive). Similar names are never joined.
- **No inference.** Rows without a UTM stay under their `utm_source`, or "(no UTM source)" and "(no UTM campaign)".
- **Sessions** use the GA4 session dimensions.
- **Forms** use the HubSpot UTMs: first touch when present, otherwise last touch. Internal contacts are excluded.
- **Accounts and projects** use the HubSpot UTMs when the person matches a form through the existing identity hash (HMAC of the email). Otherwise they use the PostHog first-touch UTMs. Otherwise they stay unattributed. The report shows the count for each basis.
- **Privacy.** The output contains only aggregates: no emails, no hashes, no person rows. A test enforces this.

## Missing values vs zeros

- A day **inside** a source's synced window with no rows is a real **0**.
- A day **outside** that window, a stage without a connector, or a value that doesn't apply (spend on an organic row) shows **–**.
- Each stage carries a status: Loaded, No data or Not connected, together with its reason, synced window and day basis.
- Rows flagged `seed` are excluded, and the report counts how many were left out. The current database has no seed rows.

## Time zone

The month window and "today" are computed in **America/Bogota**. Today is marked as a partial day.

Each source stores its own calendar day, and the report doesn't re-bucket it, since that would mean changing the connectors (#111):

- **HubSpot** stores the UTC day. A form submitted after 19:00 Bogota time lands on the next day.
- **PostHog** follows the project time zone.
- **GA4, Meta and Google Ads** follow their own property or account time zone.

## What is needed to complete it

| Gap | What is needed |
|-----|----------------|
| Logins per person | `signed_in` arrives as a daily event count. Unique people logging in, or External-only logins, would need a person-level query (a connector change that needs approval). |
| LinkedIn Ads | A LinkedIn Marketing API connection (ad account + `r_ads_reporting`). Only page analytics are synced today, so spend is "known spend only". |
| Days strictly in Bogota | HubSpot: store the Bogota day of `createdate`. PostHog: set the project time zone to America/Bogota, or use `toDate(timestamp, 'America/Bogota')`. GA4, Meta and Google Ads: set the property and account time zones to America/Bogota. All of these are connector or account changes that need approval. |
| More campaign joins | Use the exact ad campaign name as `utm_campaign` in every ad URL. |
