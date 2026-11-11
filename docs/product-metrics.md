
# Product usage metrics (phase 2)

View: **Product usage** (sidebar → Dashboards). Data: `GET api/product/metrics?cutoff=YYYY-MM-DD`
(`lib/productMetrics.js`), a read-only PostHog reader approved as an exception to memory #111,
same pattern as the GA4 range endpoint (#143). It reuses `POSTHOG_HOST`, `POSTHOG_PROJECT_ID` and
`POSTHOG_API_KEY`, caches each cutoff in memory for 30 minutes, runs at most 2 loads at once and
never writes to the database. `lib/connectors.js` and the PostHog sync are unchanged.

- Cutoff: yesterday, calendar days in America/Bogota. Window: `LAUNCH_DATE` through the cutoff.
- Internal and test accounts: `lib/internal.js` patterns, always excluded. `qa_probe` events excluded.
- No person id or email leaves PostHog; the browser receives per-account rows without identifiers.
- Each request first checks which events exist. A metric whose event has not arrived shows
  **Waiting for event · name**, never zero, and turns on by itself once Product sends the event.

## Definitions in use

| Metric | Definition | Status |
|---|---|---|
| Active users (7 days) | Unique external accounts with `signed_in` in the 7 days ending on the cutoff | Provisional: active = signed in |
| Accounts created | First `$identify` per person since launch (people created on or after launch) | Same rule as Overview / Executive |
| Accounts with a project | Unique accounts with at least one `project_created` since launch | Needs event |
| Projects created | Distinct `properties.project_id` (event uuid when missing) | Needs event |
| Avg projects per active user | Distinct projects in the last 7 days ÷ active users (7 days) | Needs event |
| 7-day activation | First project on day 0–6 after account creation, mature cohorts only | Needs event |
| Credits consumed | Sum of `properties.amount` (`POSTHOG_CREDITS_PROPERTY`) on `credits_consumed` | Needs event |
| Time to first credit use | Median days from account creation to first `credits_consumed` | Needs event |
| Monthly churn | Cancelled in the month among subscriptions active at the start ÷ active at the start | Provisional formula |

## Events Product must send from the backend (#178)

| Event | Required properties |
|---|---|
| `project_created` | `project_id`, account identified as the same PostHog person (`portal_user_id`) |
| `credits_consumed` | `amount` (number), `project_id` if applicable |
| `subscription_started` | `plan`, `plan_is_paid` |
| `subscription_cancelled` | `plan`, `reason` if known |

All events must use the same distinct id as the portal's `posthog.identify`, and test traffic
must carry `qa_probe: true`.

## Known limits

- Subscriptions started before launch are not visible, so "active at start" can be undercounted.
- Same-day start and cancel are read as start first, then cancel.
- Per-account rows are capped at 50,000; the header shows "Partial" if the cap is reached.

## Open questions for the session with David

1. Is "active" any `signed_in`, or a meaningful product action (project opened, credits used)?
2. Churn denominator: subscriptions active at the start of the month, or paid accounts only?
3. Do downgrades to free count as cancellations?
4. Retention D1/D7: calendar days or 24-hour windows?
5. Does the daily platform-usage board (requested Oct 27) belong in this phase?
