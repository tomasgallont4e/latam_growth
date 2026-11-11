
# CEO brief (Executive view)

A one-screen summary at the top of **Executive**, above a "Detail" separator that keeps every existing section unchanged. It can be exported as a one-page PDF with **Export PDF** (browser print → Save as PDF). Presentation only: no connector, backend or database change.

Logic: `public/js/ceoBrief.js` (pure, tested in `test/ceoBrief.test.js`). Rendering: `public/js/views/executive.js`. Print: `public/css/print.css`.

## Sources

| Block | Source |
|-------|--------|
| Accounts vs goal | `goalAccounts` from `api/executive` (first $identify, all hosts, all countries, internal excluded; LATAM shown apart) |
| Active users, project share, credits, churn | `api/product/metrics?cutoff=` (read-only PostHog). Cutoff = end of the selected Month or yesterday (Bogota), whichever is earlier. Same calculations as Product usage (`productUsage.js`). |
| Investment & cost per account | `view.cards.spend` and `view.cards.cps` |
| Top markets | `view.countries` (accounts created this month, pace vs the country plan) |

## KPI definitions

- **Accounts created vs goal** — semaphore on the prorated pace: expected = goal × elapsed days ÷ days in the month window. Green ≥ 90%, yellow 60–89%, red < 60%. A closed month is judged against the full goal.
- **Active users (7 days)** — unique external accounts with `signed_in` in the last 7 days; compared with the 7 days before. Tile turns red at −20% or worse, yellow from −5% to −20%.
- **Accounts with a project** — accounts created since launch with at least one `project_created` ÷ accounts created since launch; compared with the same share a week earlier (pp).
- **Monthly churn** — provisional formula from Product usage: cancellations in the month among subscriptions active at the start ÷ active at the start. Red ≥ 5%, yellow ≥ 2%.
- **Credits consumed** — sum since launch, last 7 days and change vs the prior 7 days.

## Automatic text

- **Headline**: month, accounts, % of the goal and pace state (On pace / Close to pace / Behind pace / Month closed).
- **What changed**: active users, project share and credits vs the previous period, plus the existing 7-day readout phrases (max 4).
- **Risks & blockers** (max 4): pace yellow/red with accounts per day needed, incomplete paid spend, product events not received, product load error, active users −20%, churn ≥ 5%, markets trailing their plan, funnel stages with no data.
- **Next actions** (max 3): one action per risk (close the gap, finish spend sync, ask Product for the events, check onboarding, review cancellations, review trailing markets). Default: keep the plan.

Missing data shows **No data**, **Loading…** or **Waiting for event · name**, never zero.
