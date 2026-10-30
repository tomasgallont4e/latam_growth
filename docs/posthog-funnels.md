# PostHog sign-ups and platform funnels

- Account creation (the dashboard's sign-up metric): the person's first PostHog
  `identify`, counted once. `registration_started` is the preceding funnel step;
  keep it separate and never add it to accounts created.
- The Overview and Targets use accounts created. Conversion reports both registration
  starts and accounts created so the gap between intent and account creation is visible.
- The GA4 review banner is removed; source values are preserved.

## Platform selector

Overview and Conversion have a platform selector. GA4, HubSpot and ad platforms show
their own activity counters without pretending these are linked person journeys.
PostHog offers three funnels:

1. Website → Registration — signup CTAs only:
   `marketing_page_viewed` → `marketing_cta_clicked` → `registration_started`.
2. MVP acquisition → completed review:
   `marketing_cta_clicked` → `registration_started` → `account_created` →
   `first_use_path_selected` → `blueprint_generated`, plus any further review steps
   present in the saved insight. No unseen review event name is invented.
3. Embudo landing a cuenta y proyecto (sin internos):
   `marketing_page_viewed` → `marketing_cta_clicked` → `registration_started` →
   `$identify` (displayed as “Identify”) → PostHog Action `Proyecto creado (clic)`.
   The final step is the first project-create click proxy, not confirmed creation.
   The account step is the first identify, matching the dashboard's account definition;
   the separate backend `account_created` and `project_created` events are not used here.

The server finds the saved insight for this funnel by title and matching ordered steps
(including the `ActionsNode` for “Proyecto creado (clic)”), then reuses its query,
preserving host, CTA, qa_probe and other saved filters.
The selected dates and test-account switch are applied; for the landing-to-project
funnel, the saved insight must contain exactly those five steps. With “Exclude
internal tests” enabled, the request sets PostHog's `filterTestAccounts` flag and
adds negative person-property filters from `INTERNAL_DOMAINS` and
`INTERNAL_COMPANIES` (defaults: `think4ever.com`, `think4ever`, `moadbus`). Unknown
people with neither an email nor company property cannot be classified as internal.
Configure PostHog's project-level internal/test-user filters too, so other insights
stay consistent. The native ordered funnel response supplies person counts and
conversion times. The window comes from the saved definition (14 days by default).
Ambiguous or missing saved insights show an explicit unavailable state rather than
substituting event totals or screenshot numbers.

The service key needs both `insight:read` (to list the saved funnel) and `query:read`
(to run it) for the configured project, currently `347860`. No `insight:write` scope
is needed; no additional secret is added and no saved PostHog insight is modified.

Unavailable queries are not zero results. Steps with zero conversions and no matching
events in the selected period show Awaiting events. Steps with observed instrumentation
and zero ordered conversions can display zero. Missing downstream instrumentation never
produces a claimed 100% abandonment.

API: `GET /api/funnels/posthog?funnel=website|mvp|landing_project&from=YYYY-MM-DD&to=YYYY-MM-DD&exclude=1|0`.
Requests use a bounded five-minute cache with concurrent requests coalesced.

Reference: https://posthog.com/docs/api/queries (FunnelsQuery / funnel response).
