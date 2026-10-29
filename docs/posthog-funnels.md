# PostHog sign-ups and platform funnels

- Sign-up: `registration_started`, first per person since launch. `account_created`
  is a separate downstream step, not a prerequisite for a sign-up.
- The global chart and Targets use this definition, without adding HubSpot contacts
  or `ph_new_persons`. Sync PostHog once after deployment for the new daily metric.
- The GA4 review banner is removed; source values are preserved.

## Platform selector

Overview and Conversion have a platform selector. GA4, HubSpot and ad platforms show
their own activity counters without pretending these are linked person journeys.
PostHog offers the two funnels pictured by the user:

1. Website → Registration — signup CTAs only:
   `marketing_page_viewed` → `marketing_cta_clicked` → `registration_started`.
2. MVP acquisition → completed review:
   `marketing_cta_clicked` → `registration_started` → `account_created` →
   `first_use_path_selected` → `blueprint_generated`, plus any further review steps
   present in the saved insight. No unseen review event name is invented.

The server locates the saved insights by their titles and matching event prefixes,
then reuses their query, preserving host, CTA, qa_probe and other saved filters.
The selected dates and test-account switch are applied; the native ordered funnel
response supplies person counts and conversion times. The window comes from the saved
definition (14 days by default). Ambiguous or missing saved insights show an explicit
unavailable state rather than substituting event totals or screenshot numbers.

The existing personal key needs read access to insights and queries in project 347860.
No additional secret is added and no saved PostHog insight is modified.

Unavailable queries are not zero results. Steps with zero conversions and no matching
events in the selected period show Awaiting events. Steps with observed instrumentation
and zero ordered conversions can display zero. Missing downstream instrumentation never
produces a claimed 100% abandonment.

API: `GET /api/funnels/posthog?funnel=website|mvp&from=YYYY-MM-DD&to=YYYY-MM-DD&exclude=1|0`.
Requests use a bounded five-minute cache with concurrent requests coalesced.

Reference: https://posthog.com/docs/api/queries (FunnelsQuery / funnel response).
