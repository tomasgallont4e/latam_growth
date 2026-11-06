# Executive · Campaign funnel

The Executive view shows one consolidated funnel for the selected month, directly below the KPI cards. Every stage uses the same window: from the first day of the month (or the launch date) through the last complete day covered by the syncs. The PostHog activation funnel now sits at the end of the page.

The source views (Data Sources, Paid, Social, etc.) are for auditing. This view explains consolidated performance.

## Stages

| # | Stage | Source | Volume | vs previous stage | Target key (Targets) | Cost per result |
|---|-------|--------|--------|-------------------|----------------------|-----------------|
| 1 | Ad and page impressions | Meta Ads, Google Ads, LinkedIn Ads (pending); Facebook page, Instagram, LinkedIn page | Paid + organic, reported impressions | — | `total_impressions` (paid only) | CPM (paid) |
| 2 | Clicks to the landing | Meta `outbound_clicks`, Google Ads clicks | Outbound clicks only | Clicks ÷ paid impressions of the same networks | `clicks` | Spend of the same networks ÷ clicks |
| 3 | Landing sessions | GA4, `go.think4ever.com` only | All go-host sessions | Campaign-matched: sessions ÷ ad clicks for campaigns whose name equals `utm_campaign` | `landing_sessions` | Spend of matched campaigns ÷ their sessions |
| 4 | Form submissions | HubSpot external contacts (+ GA4 `sign_up` as a secondary figure) | Forms | Forms ÷ go-host sessions | `crm_contacts` | Blended |
| 5 | Accounts created · verified | PostHog first `$identify`, approved hosts, external; `account_verified`; HMAC match with HubSpot | Created accounts (verified and form-matched shown beside it) | Accounts ÷ forms (blended) | `platform_signups` | Blended |
| 6 | Active builders | PostHog `project_created` (from the identity cohort) | Accounts with a real project | Builders ÷ accounts created in the window | — | Blended |

Pace follows the Targets rule: the month target is prorated to the days elapsed. Green means at least 100%, yellow 90% to under 100%, and red under 90%.

## Attribution rules

- **Impressions** are added as each platform reports them. They are not people, and they are not deduplicated across platforms. Unique consolidated reach would need a shared identity source, which is not available. Video plays are not counted as impressions.
- **Clicks** count only outbound clicks that can produce a visit. Meta `inline_link_clicks` and all-clicks are not used in this funnel.
- **Ads ↔ GA4**: matched by UTM and campaign name in the same date window. Sessions without `utm_campaign` stay visible as "(not set)" and never receive ad clicks.
- **HubSpot ↔ PostHog**: HMAC-SHA256 of the normalized email (`IDENTITY_HMAC_KEY`), truncated to 32 hex characters. The connector computes it in memory. Neither the email nor PostHog person IDs are stored.
- **PostHog ↔ builder activity**: each person's identity-cohort row carries the account date, the first `account_verified`, and the first `project_created`. Day 0 means the project was created on the account day. "14 days" means within 14 days of the account. The 14-day rate only uses cohorts that are at least 14 days old.
- **Published content** (URL and date per builder) is not integrated yet. It shows as "No data yet", and the builders stage stays Under review.
- A network or source that has not reported is shown as **pending**. The total then includes only the reported networks and is marked **Under review**. Costs computed while a paid network is pending are labelled "known spend only". LinkedIn Ads has no connector yet.

## Stored data (all additive)

| Connector | New data |
|-----------|----------|
| Meta | metric `ad_outbound_clicks` (dim campaign); snapshot `outbound_coverage`; metric `organic_views` (dim platform: Facebook / Instagram); snapshot `organic_coverage` |
| GA4 | snapshot `executive_landing_utm` (coverage) + `executive_landing_utm_N` (date, source, medium, campaign, content, sessions) |
| HubSpot | `email_hmac` on each form event |
| PostHog | snapshot `identity_cohort` (coverage) + `identity_cohort_N` (created, verified, project, id_hash, first-touch UTMs) |

Long tables are split into numbered snapshots of up to 1,000 rows each, at most 20 per table. A coverage row marks the table as `truncated` when it reaches that limit.

## Variables

| Variable | Use |
|----------|-----|
| `IDENTITY_HMAC_KEY` | Secret for the email HMAC. Required for HubSpot `email_hmac` and the PostHog identity cohort. Generated in `.env`; never share or commit it. |
| `META_PAGE_ID` | Facebook page for organic views (`page_media_view`, falling back to `page_impressions`). |
| `META_IG_USER_ID` | Instagram business account for organic `views`. |
| `META_PAGE_TOKEN` | Page token with insights permissions. Falls back to `META_TOKEN`. |

Changing `IDENTITY_HMAC_KEY` changes every hash. Rotate it only together with a full re-sync of HubSpot and PostHog.
