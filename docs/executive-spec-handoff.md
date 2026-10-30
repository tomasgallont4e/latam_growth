# Executive spec — handoff summary

> Read this first when resuming the Executive-tab spec work. The user is pausing for a higher-priority tangent.

## Source and working files

- Original design/assignment: `Downloads/think4ever-tablero-286-spec-executive-equipo-28oct.pdf` (especially §§3.1–3.9 and §7 Reparto).
- Working implementation draft: [`executive-implementation-spec-draft.md`](executive-implementation-spec-draft.md).
- Repository: `C:/Users/gutty/latam_growth` (`tomasgallont4e/latam_growth`). Latest reviewed `origin/main`: `022cf7d` (PR #9 merge). Current work branch: `feat/executive-tab-v1`, based on that `origin/main`.
- Main baseline test run before implementation: `npm test` — 66 passed. Current feature-branch suite passes **81/81**; independent review passed with no security or logic errors.
- Official implementation spec: `docs/executive-implementation-spec.md`; discovery details: `docs/executive-implementation-spec-draft.md`.
- Feature branch `feat/executive-tab-v1`: `lib/connectors.js` adds a dedicated first-identify, event-GeoIP, external-only PostHog metric with explicit allowlist, deterministic tie-break, result-limit/hasMore guards, and excluded-host coverage; `lib/executive.js` consumes it and handles month/date coverage; `server.js` validates `?month=`. Tests: 81/81; independent review passed. Isolated HTTP smoke: valid month 200, invalid 400, empty-store coverage stays null/pending. No live source sync, commit, push or deployment yet.


## Decisions and verified findings

### GA4 landing sessions

- **User decision:** Executive v1 uses `go.think4ever.com` only for landing sessions. Do not include `think4ever.com` until its tag/data is verified.
- GA4 stream `Landing LATAM` has URL `https://go.think4ever.com`, Measurement ID `G-B1HW840KBC`, and reported active collection.
- Cross-domain settings list `go.think4ever.com`, `portal.think4ever.com`, and `think4ever.com` with `Contains`; that config alone does not prove each host sends data.
- GA4 Explore with `Sessions` and `Hostname`, `Date`, `Country` returned daily country rows for `go.think4ever.com`.
- Exact `Hostname = think4ever.com` query for Last 28 days (Oct 2–29, 2026) returned no data. Tag Assistant on `think4ever.com/` in Chrome Incognito timed out and found 0 debuggable tags; `think4ever.com/latam` returned 404. Realtime showed `/latam` activity but no hostname. Thus root-domain coverage remains unverified; user chose to exclude it from v1.
- Current main syncs daily `ga_geo_sessions` by `date` + `country` and applies `hostName IN SITE_HOSTS` (defaults include `think4ever.com`, `www`, `go`, `portal`). It does not return hostname as a dimension, so those allowed hosts can be aggregated together. Add a separate/parameterized Executive report filtered to `go.think4ever.com`; preserve the shared filter for existing screens.

### PostHog accounts and country

- Current dashboard account metric: first `$identify` per person, stored as `ph_accounts`. `ph_signups` is `registration_started`; `ph_new_persons` is observed new people, not verified accounts. Preserve these distinctions.
- First `$identify` is the dashboard's operational proxy, not proof of successful account persistence. `account_created` is documented/defined separately, but production emission after DB commit is not verified in this repo.
- PostHog Trends now confirms `Identify` → `Unique users`, a 30-day range, and an **event's Country name** breakdown with country rows. This proves some Identify events carry country values in the observed window, not that every account has one or that the value persists on the person profile. The Host view showed portal plus unclassified cell hosts.
- Feature branch uses event property `properties.$geoip_country_name` on each person's earliest `$identify`, emits `ph_exec_accounts` / `ph_exec_accounts_geo`, and limits certified counts to the PDF's exact-host allowlist. Cell/hostless external accounts are excluded, counted in an aggregate coverage warning, and keep the metric `pending`. Live sync/property result still needs validation.
- PostHog host observations: a broad Host breakdown showed `portal.think4ever.com`, `cell-ssm-use1-0006.us.portal.think4ever.com`, and `cell-ssm-use1-0008.us.portal.think4ever.com`. Host-selector suggestions also showed `cell-ssm-use1-0005.us.portal.think4ever.com` and other regional cells. **User reports:** 0005 had no activity; 0006 showed some activity but not all page traffic. These are not yet classified as production vs platform/test hosts; do not add them to the allowlist without confirmation.
- The attached Excel export has person IDs and created_at but no country/host/event columns. No names, emails, or person IDs were copied into either Markdown file.

## Current-main implementation gaps

- Main still lacks the Executive-specific `go.think4ever.com` GA4 metric, live Executive navigation, month-filtered API and per-paid-channel status. The feature branch now contains the GA4 report and first PostHog/month API slices; the API still lacks the complete v1 cards/funnel/Top 5/“What changed” and channel-state contract.
- Generic source `pending` exists, but per-paid-channel `loaded / no campaigns / pending` with last sync and reason does not.
- LinkedIn connector is organic Page analytics only; no paid Ads reporting connector/`li_ad_spend` in main.
- Meta connector exists, but paid-ad account access is blocked; keep Meta `pending`, never show a fake zero or complete CPS.

## Guti's assignment and external dependencies (source PDF §7)

- Implement/confirm PostHog account metric and country/host filters; maintain GA4 daily country sessions; complete Executive API calculations; add paid-channel status; resolve currency conversion; complete internal domains/tester exclusions; confirm LinkedIn patch/API access; update Meta account ID only after correct account sharing.
- **Publicidad/account owner:** Meta account share; ad-account currencies; MoadBus domains/tester list.
- **Tomás:** clarify landing form vs portal-account behavior; portal DB cross-check; integrate Executive front end.
- **Research:** validation sheet, acceptance checks, under-review flags, approval before external sharing.
- **Dirección:** approve proposed goal ramp where required.
- The Excel suggests `moadbus.com` and `moadbusglobal.com` as candidate internal domains; validate before excluding. Never exclude all Gmail accounts.

## Next execution sequence when resumed

1. Validate the new PostHog metric on a real sync; Product must classify the excluded cell hosts before adding any to the allowlist. Confirm internal/test domains and account semantics.
2. Guti: finish the Executive API contract (KPI cards, country ranking, funnel, channel states/currency and “What changed”); keep Meta pending until access.
3. Tomás: integrate the live Executive UI and empty/under-review/channel states from that API contract.
4. Research: reconcile against the portal database and complete acceptance/validation before sharing beyond the team.
5. Verify LinkedIn campaigns and currencies before labeling `no campaigns` or calculating combined spend.

## Interaction preference

User prefers Spanish, beginner-friendly explanations, and one GUI action per turn with screenshots between steps. Explain what a tool is before asking them to use it. When interpreting screenshots, separate visible evidence from prior context and state when a property/hostname/event is not actually shown.
