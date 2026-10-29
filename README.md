# LATAM Growth · think4ever

One dashboard for the LATAM launch: landing traffic, sign-ups, platform accounts, social and paid. Built by Research.

## Views

| View | What it shows |
|---|---|
| Overview | LATAM 500K goal (accounts created since launch, counted once per person at their first PostHog identify; measurement only, no deadline), accounts by country against each market's share of the plan, summary figures, funnel, research reading, daily sessions by source with timeline notes |
| Acquisition | Sessions by source (HubSpot), channels (Google Analytics), UTM campaigns, countries |
| Conversion | Landing events (Tag Manager and Google Analytics), sign-up log, platform sign-ups (PostHog), pages, forms |
| Social and paid | Meta, LinkedIn, Google Ads and Clarity; cost per sign-up once campaigns run |
| Ad loader | Approved ad pieces, the checklist for each one, and the Google Ads, Meta and LinkedIn API payloads (task 124) |
| Data sources | Status of every source, CSV import, how each one connects, definitions, load history |

## Sign-in

Every page and API route asks for a user and password, including the public link.

| Service variable | What it holds |
|---|---|
| `DASH_USERS` | One or more users as `user:password:role`, separated by commas. Roles: `admin` (everything), `read` (view only), `ads` (view plus the ad loader). A user without a role is `admin`. Without this variable the app stays locked for everyone. |
| `SESSION_SECRET` | Random text that signs the session cookie. Changing it signs everyone out. |
| `SESSION_DAYS` | Optional. Days a session lasts (default 30). |

- Credentials live only in the service variables, never in the code, the seed files or the vault.
- 8 failed attempts from one address (or 60 in total) in 15 minutes block sign-in for 15 minutes.
- The server enforces the role on every change; the page also hides the controls a role cannot use.
- Sources with their keys in the service variables load by themselves on the server (see "How data gets in"); they do not need anyone's browser.
- `/api/health` stays open for the platform health check; it returns no data.

## Ad loader

Leadership loads each approved piece here: creative link, copy, language, persona (p01 to p13), targeting, budget, dates and UTM tags.

- **Approvals**: three per piece (Community Manager, Advertising, Leadership), given from the piece after it is saved. Whoever loaded the piece cannot approve it, and each approval comes from a different person. Changing the copy, creative, targeting, budget, dates or links clears the approvals.
- **History**: every load, edit, approval, withdrawal and archive is recorded with the user and time.
- **Checklist**: language, platform text limits, persona code in `utm_content`, https landing on think4ever.com, the three UTM fields, country, daily budget at or under the cap, valid dates, the three approvals from three different people. Each failed item says what to fix.
- **Payloads**: Google Ads (`googleAds:mutate`), Meta Marketing API (campaign, ad set, creative, ad) and LinkedIn Marketing API (campaign group, campaign, post, creative). Everything is created **paused**.
- **Test mode** (default): payloads are built and shown, never sent. "Download all payloads (JSON)" gives the set for loading by hand.
- **Live mode**: needs `AD_LOADER_LIVE=1` and each platform's variables. Sending stays off until the connector is tested with the real account.
- Example pieces show how a piece looks and are never sent. Pieces are archived, never deleted.

| Variable | What it holds |
|---|---|
| `AD_BUDGET_CAP_USD` | Daily budget cap per piece (default 50) |
| `AD_LOADER_LIVE` | `1` to allow sending once the connectors are tested |
| Google Ads | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_REFRESH_TOKEN` |
| Meta | `META_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PAGE_ID` |
| LinkedIn | `LINKEDIN_TOKEN`, `LINKEDIN_AD_ACCOUNT_ID`, `LINKEDIN_ORG_ID` |

## How data gets in

1. **Seed** (`seed/*.json`): loaded on first boot for each source without data (HubSpot and Google Analytics, 1 to 14 Oct 2026).
2. **Connectors** (`lib/connectors.js`): HubSpot, Google Analytics 4, PostHog, LinkedIn, Meta Ads, Google Ads and Clarity. They run on the server 20 seconds after each start and then every `SYNC_EVERY_HOURS` hours (default 6), and from "Sync now", only when their service variables are set. Credentials go in the service variables, never in files. Every run, with its errors, shows in Data sources → Load history.
3. **CSV import** in Data sources: `date, metric, value[, dim, dim_value]`.
4. **API**: `POST api/ingest` with `{ source, from, to, metrics, snapshots, events, notes }`. If `INGEST_KEY` is set, send it as `x-ingest-key`.

## Service variables

| Source | Variables |
|---|---|
| HubSpot | `HUBSPOT_TOKEN` (private app: contacts read, forms, business-intelligence) |
| Google Analytics 4 | `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT` (key JSON of a service account with Viewer access) |
| PostHog | `POSTHOG_HOST`, `POSTHOG_PROJECT_ID`, `POSTHOG_API_KEY` |
| Meta Ads | `META_TOKEN`, `META_AD_ACCOUNT_ID`; optional `META_API_VERSION` (default v23.0) |
| LinkedIn | `LINKEDIN_ORG_ID` (129864039), and `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REFRESH_TOKEN` (or a `LINKEDIN_TOKEN` that lasts 60 days). Needs the Community Management API approved by LinkedIn. |
| Google Ads | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`; optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (manager account), `GOOGLE_ADS_API_VERSION` (default v21) |
| Clarity | `CLARITY_TOKEN` |
| Optional | `SYNC_EVERY_HOURS` (default 6), `AUTO_SYNC=0` (manual "Sync now" only), `TEAM_CODE` (asks for a code before using the API), `INGEST_KEY`, `LAUNCH_DATE` (default 2026-10-01), `INTERNAL_DOMAINS` (default think4ever.com) |

API versions change often: confirm the current one on the first sync with each platform and set it in the variable if the default is retired.

## UTM and product attribution

The dashboard now reads GA4 sessions by UTM, landing page and city, and it is ready to show confirmed `project_created` events from PostHog. This needs tracking changes outside this repository: link tags, hidden HubSpot fields, and backend product events. Follow the complete owner-by-owner checklist in [docs/utm-measurement.md](docs/utm-measurement.md). The existing PostHog Action is intentionally kept as a click proxy until the backend event exists.

## How it runs

- Node 18+, Express, MySQL (`mysql2`). Creates table `gd_items` on boot. Reads `DATABASE_URL` or `DB_*` and listens on `process.env.PORT`. All URLs are relative, so it works behind the `/run/<id>/` proxy.
- Without a database it uses `data/local.json` (local tests: `node _local.js` → http://localhost:3015).

## Upload to Think4Ever

1. New project (Node.js + MySQL), import `t4e-growth-dashboard.zip` (no `node_modules`, `data/` or `_local.js`).
2. Start command `npm start` (installs the dependencies itself, then boots; `node server.js` only works after they are installed) → health check on `/api/health`.
