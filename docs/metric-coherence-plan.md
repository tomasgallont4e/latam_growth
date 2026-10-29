# Metric coherence: execution and acceptance plan

1. **One definition per outcome.** Keep HubSpot contacts, new PostHog people and verified
   accounts separate. Never add contacts and people together. A verified-account actual
   requires a trusted, deduplicated verification report; do not infer it from pageviews,
   first visits, person creation or a create-project click.
2. **Internal coverage.** Sync PostHog people by Internal / External / Unknown using the
   configured domains and companies. Apply the same population to country and attribution
   reports. Old unclassified loads cannot claim internal exclusion: require a resync.
   Unknown identities remain visible as unknown, not automatically verified/external.
3. **Comparable measurements.** Use GA4 sessions for GA4 engagement. Display event counts,
   CRM contacts and product people as independent stages, without fabricated drop-offs or
   weakest-step labels. Activation in seven days needs a dated, linked cohort; the current
   Action remains an independent click proxy. Missing reports are null, successful empty
   reports are zero. Do not calculate impression-to-visit from unmatched platform totals.
4. **Goals and countries.** Keep saved targets. Compare verified-account goals only with
   verified accounts; use exact-window country user snapshots, never daily user sums.
   Warn when plan rates disagree with inputs. Offer explicit rate recalculation in Targets,
   requiring Save to persist it. Keep monthly target records distinct from the scale plan.
5. **Time and attribution.** Separate date range from grouping. Apply the range to counts
   and the grouping to paid-channel and contact-attribution tables. Include paid UTM,
   other identified source, QA/internal and unknown attribution; do not call missing UTM
   direct. Label LinkedIn post clicks as content clicks, and lifetime post statistics as such.
6. **Coverage and QA.** Surface native GA4 user inconsistencies without changing reported
   values. Connected does not imply a populated ad report. Test the audited 4+34 case,
   missing Action, 508/1752 engagement, 60% vs 0.577% plan, internal filtering, country
   deduplication, no-spend paid sessions, weekly/monthly totals and real zero vs missing.

## Current sign-up definition (updated from the supplied PostHog funnels)

The dashboard goal and `total_signups` / `platform_signups` use the first
`registration_started` per person since launch. They do not require `account_created`
and do not substitute person creation or add CRM contacts. The persisted plan field
`verified_users` keeps its legacy storage name so saved goals remain intact; the UI
labels it Sign-ups. See `posthog-funnels.md` for the platform selector and native funnels.

## Optional verification contract (separate from sign-ups)

`posthog` metric `ph_verified_accounts`, split with `dim=account_type` and
`dim_value=External|Internal|Unknown`, means one confirmed account verification per stable
product account, dated by verification time, deduplicated before ingest. Snapshot
`verified_accounts` must cover the report dates and have a first row
`{ available: true, unit: 'verified_account' }`. Country reports use separate
`ph_verified_accounts_geo` metrics (external verified accounts only, `dim=country`,
country names as dimension values) and require `country_complete: true` in that row.
Including internal accounts also requires `country_internal_complete: true` and
separate `ph_verified_accounts_geo_internal` facts. Never mix population types
under one country upsert key. Unknown/unclassified identities cannot satisfy the
external verified-account contract.
This deployment does not claim that such a report exists or enable an unverified event.
Until supplied by a trusted product export/integration, the 500K actual is unavailable.

Seven-day activation requires a separate verified registration cohort with its signup and
project dates. The click Action alone cannot supply this metric. Marketing must distinguish
test contacts made with public email accounts; production tests should use medium `qa`.

## Rollout

Run regression tests and browser QA with synthetic data, then publish code. Restart the
dashboard and sync PostHog, GA4 and HubSpot. Existing data and saved targets are preserved;
source-owned connector facts are refreshed by the normal sync. No database migration is needed.
The native GA4 total/new-user discrepancy still requires checking the property reporting
identity, thresholds and original report; the dashboard must surface it, never clamp counts.
