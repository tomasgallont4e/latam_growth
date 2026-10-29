'use strict';
// Catalog of data sources. The live state (connected, pending, last sync) is stored as kind "source"
// and overrides `state` and `note` below.

module.exports = [
  {
    key: 'hubspot', name: 'HubSpot', area: 'Landing and CRM',
    provides: 'Landing sessions by source and day, contact attribution (UTM when configured), countries, pages, form entries and contacts',
    env: ['HUBSPOT_TOKEN', 'HUBSPOT_UTM_PROPERTIES'],
    connect: 'Private app token with the scopes crm.objects.contacts.read, forms and business-intelligence, saved as the service variable HUBSPOT_TOKEN.',
    state: 'connected', note: 'Loaded by Research from the HubSpot portal on 14 Oct.',
  },
  {
    key: 'ga4', name: 'Google Analytics 4', area: 'Landing behaviour',
    provides: 'Users, engaged sessions, UTM campaign/piece, landing page, city, channels and landing events: form_start, sign_up, login, generate_lead',
    env: ['GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT'],
    connect: 'Service account with Viewer access on the property; save the property id as GA4_PROPERTY_ID and the key JSON as GA4_SERVICE_ACCOUNT.',
    state: 'connected', note: 'Read access granted on 14 Oct; loaded by Research.',
  },
  {
    key: 'gtm', name: 'Google Tag Manager', area: 'Event definitions',
    provides: 'Defines the landing events that Google Analytics records (sign-up, log-in, form start)',
    env: [],
    connect: 'No data of its own: it feeds Google Analytics. Listed so every event in this dashboard has a documented origin.',
    state: 'connected', note: 'Access granted on 14 Oct.',
  },
  {
    key: 'posthog', name: 'PostHog', area: 'Platform',
    provides: 'Accounts, activation proxy and confirmed project_created events by UTM when Product sends the event properties',
    env: ['POSTHOG_HOST', 'POSTHOG_PROJECT_ID', 'POSTHOG_API_KEY', 'POSTHOG_ACTIVATION_ACTION_ID', 'POSTHOG_PROJECT_CREATED_EVENT'],
    connect: 'Personal API key with read access to the project, saved as POSTHOG_API_KEY, with POSTHOG_HOST and POSTHOG_PROJECT_ID. Optional POSTHOG_ACTIVATION_ACTION_ID is the click proxy; POSTHOG_PROJECT_CREATED_EVENT defaults to project_created and is the confirmed backend event.',
    state: 'pending', note: 'Access confirmed on 13 Oct; data pull scheduled for the 16 Oct baseline.',
  },
  {
    key: 'clarity', name: 'Microsoft Clarity', area: 'Landing behaviour',
    provides: 'Heatmaps, scroll depth, rage and dead clicks, traffic origin',
    env: ['CLARITY_TOKEN'],
    connect: 'Data export token from the Clarity project settings, saved as CLARITY_TOKEN.',
    state: 'pending', note: 'Installed on the landing by the web team; access requested on 14 Oct.',
  },
  {
    key: 'meta', name: 'Meta (Facebook and Instagram)', area: 'Social and paid',
    provides: 'Daily campaign spend, impressions, link clicks, platform results and unit costs. Link clicks do not guarantee a landing session',
    env: ['META_TOKEN', 'META_AD_ACCOUNT_ID'],
    connect: 'System user token with ads_read, saved as META_TOKEN, and the ad account id as META_AD_ACCOUNT_ID. Exports can also be loaded as CSV.',
    state: 'pending', note: 'Access to be requested.',
  },
  {
    key: 'linkedin', name: 'LinkedIn', area: 'Social and paid',
    provides: 'Page followers, post impressions and engagement. Paid spend and clicks require the Advertising API or CSV',
    env: ['LINKEDIN_ORG_ID', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_REFRESH_TOKEN'],
    connect: 'Community Management API: a LinkedIn developer app linked to the page, with that product approved by LinkedIn, and a token from a page admin. Until the approval, the page analytics export (CSV) can be loaded here.',
    state: 'pending', note: 'Access managed by leadership; export to be loaded.',
  },
  {
    key: 'google_ads', name: 'Google Ads', area: 'Paid',
    provides: 'Spend, clicks and cost per sign-up by campaign',
    env: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'],
    connect: 'Developer token from the manager account API Center, an OAuth client and a refresh token of a user with access to the ad account. Linking Google Ads to Google Analytics 4 also brings costs into GA4.',
    state: 'not_started', note: 'No account or campaign yet.',
  },
];
