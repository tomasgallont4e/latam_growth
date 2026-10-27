# UTM and product attribution runbook

This dashboard can report the chain below only when every handoff preserves the same attribution values.

```text
ad / post / email -> landing session -> form or account -> project_created -> dashboard
```

## 1. Link standard (Marketing)

Every distributable link must include these fields in lowercase, with no spaces:

```text
utm_source    platform or publisher: linkedin, instagram, facebook, google, email
utm_medium    distribution method: paid_social, organic_social, cpc, email, partner
utm_campaign  stable campaign identifier: latam_co_launch
utm_content   persona code + piece: p03 or p03_video_a (always starts with pNN, p01–p13)
utm_term      optional audience or keyword: bogota_founders
utm_id        optional immutable campaign ID
```

Example:

```text
https://go.think4ever.com/latam?utm_source=linkedin&utm_medium=paid_social&utm_campaign=latam_co_launch&utm_content=p03_video_a&utm_term=bogota_founders
```

**Persona standard:** `utm_content` always starts with the persona code `pNN` (`p01`–`p13`), optionally followed by `_` and the piece name (`p03`, `p03_video_a`, `p03_carousel_b`). The dashboard groups sign-ups and sessions by that prefix, so `p03_video_a` and `p03_carousel_b` both count for persona `p03`. A value without the prefix is shown in the campaign tables but not in "Sign-ups by persona".

Do not reuse one `utm_content` value for more than one creative. Keep the same `utm_campaign` in the advertising platform and in the destination URL. Preserve platform click IDs (`gclid`, `fbclid`, `msclkid`) when the platform appends them.

## 2. Landing and Google Tag Manager (Web team)

GA4 reads UTMs from the arrival URL automatically. It still needs these events in GTM/website code:

| Event | Trigger | Mark as GA4 key event? |
|---|---|---|
| `form_start` | First interaction with the sign-up form | No |
| `sign_up` | Successful landing-form submit, once only | Yes |
| `cta_click` | Optional; click that opens or sends to sign-up | No |

On the first landing pageview, read `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `utm_id`, `gclid`, `fbclid`, `msclkid`, and the landing URL. Store first-touch values until signup; update a second set of last-touch values on each new tagged visit. Never put an email address in a UTM, event property, or URL.

Pass the values to HubSpot in hidden form inputs named exactly:

```text
utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page
first_utm_source, first_utm_medium, first_utm_campaign, first_utm_content
```

The form must set these inputs before submit, including when the visitor opens the form after a redirect.

## 3. HubSpot (CRM owner)

Create the contact properties listed above as single-line text fields. Add them as hidden fields to every LATAM landing form. Then set this service variable on the dashboard, using only property internal names that actually exist:

```text
HUBSPOT_UTM_PROPERTIES=utm_source,utm_medium,utm_campaign,utm_content,utm_term,landing_page,first_utm_source,first_utm_medium,first_utm_campaign,first_utm_content
```

`hs_analytics_source` and HubSpot’s original/latest source fields are also read automatically. The explicit fields above are required because they preserve the campaign and creative names needed for reporting.

## 4. Portal and PostHog (Product team)

The current PostHog Action **Proyecto creado (clic)** is only a click proxy. Add the real event on the server after the project database transaction succeeds.

```js
// Use the portal's stable internal user ID, never an email, as distinct_id.
posthog.identify(portalUserId, {
  utm_source: firstTouch.utm_source,
  utm_medium: firstTouch.utm_medium,
  utm_campaign: firstTouch.utm_campaign,
  utm_content: firstTouch.utm_content,
  landing_page: firstTouch.landing_page,
});

// Only after the project was successfully persisted.
posthog.capture({
  distinctId: portalUserId,
  event: 'project_created',
  properties: {
    project_id: project.id,
    portal_user_id: portalUserId,
    utm_source: firstTouch.utm_source,
    utm_medium: firstTouch.utm_medium,
    utm_campaign: firstTouch.utm_campaign,
    utm_content: firstTouch.utm_content,
    landing_page: firstTouch.landing_page,
  },
});
```

Capture `account_created` in the same way after a successful account creation. Do not rely on `$autocapture` for either business event. On logout, reset the browser PostHog identity so a later user on the same device is not associated with the prior account.

If the landing and portal are different domains, pass the stored attribution values through the signup redirect or signup API. A connector cannot reconstruct an attribution value that was dropped between domains.

## 5. Dashboard operator checklist

1. Deploy the dashboard code.
2. Add `HUBSPOT_UTM_PROPERTIES`, `POSTHOG_PROJECT_CREATED_EVENT=project_created`, and leave `POSTHOG_PROJECT_CREATED_ENABLED=0` until the event is verified.
3. Complete steps 1–4 for a test URL with a unique `utm_content`.
4. In GA4 Realtime/DebugView, confirm the session and `sign_up` event.
5. In HubSpot, confirm the contact has all hidden UTM properties.
6. In PostHog, confirm `account_created` and `project_created` include the UTM properties and a stable `portal_user_id`.
7. After verifying the event in PostHog, set `POSTHOG_PROJECT_CREATED_ENABLED=1`. This deliberately enables the more expensive UTM aggregation only after Product has installed the event.
8. Use **Data Sources → Sync now** for GA4 and PostHog. In **Marketing campaigns → Campaign attribution**, verify the GA4 session row and, after project creation, the confirmed-project row.

Historical traffic without UTMs will remain `(not set)`; this is expected and should not be backfilled with guesses.

## 6. Domain filter (SITE_HOSTS)

The dashboard measures only the landing, the portal and the main site. The list lives in the service variable `SITE_HOSTS` (default `think4ever.com,www.think4ever.com,go.think4ever.com,portal.think4ever.com`).

| Connector | What is filtered |
|---|---|
| GA4 | Every report (channels, events, countries, daily countries, totals, UTM) uses a `hostName` filter on `SITE_HOSTS`. |
| PostHog | Events and active users: `$host` in `SITE_HOSTS`, or no `$host` (backend events from the portal). New people, their country and UTM: only people with at least one event on `SITE_HOSTS` since `LAUNCH_DATE`. The activation Action is filtered the same way; `project_created` is never filtered. |
| HubSpot sign-ups | Both forms, but only when the contact's `hs_analytics_first_url`, `hs_analytics_last_url` or `landing_page` is on `SITE_HOSTS`. Contacts created by API without any web visit are left out. |
| HubSpot traffic | Not filterable through HubSpot's API. Kept and labelled "todo el sitio" in the views and on Data Sources. |

Syncs run one at a time per source ("Sync now" answers 409 while a sync is running), and sign-up events are keyed by the HubSpot contact id, so repeated syncs replace rows instead of duplicating them.
