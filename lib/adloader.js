'use strict';
// Ad loader (Research Hub task 124). Takes approved ad pieces from Advertising and turns them into the API calls for
// Google Ads, Meta and LinkedIn. Test mode by default: it validates each piece against the checklist and builds the
// payloads, but never sends them. Live sending needs AD_LOADER_LIVE=1 plus each platform's credentials in the service
// variables, and every campaign is created PAUSED.

const PERSONAS = {
  p01: 'Software developers and analysts', p02: 'Database, systems and network professionals', p03: 'ICT technicians and user support',
  p04: 'ICT managers', p05: 'Designers', p06: 'Business and management analysts', p07: 'Finance and investment analysts',
  p08: 'Data, statistics and research specialists', p09: 'Marketing and advertising professionals', p10: 'Accountants and auditors',
  p11: 'Engineers (non-ICT)', p12: 'Business and operations managers', p13: 'Higher-education and IT educators',
};
const PLATFORMS = ['google', 'meta', 'linkedin'];
// Three approvals per piece (agreed 14-oct): Community Manager, Advertising and Leadership. Whoever loads a piece
// does not approve it, and each approval comes from a different person.
const SIGNOFFS = ['community', 'advertising', 'management'];
const SIGNOFF_NAMES = { community: 'Community Manager', advertising: 'Advertising', management: 'Leadership' };
const LANGS = { es: 'Spanish', en: 'English' };
// Text limits per platform (characters). Google values are hard limits; Meta and LinkedIn are the lengths that show
// without truncation in the feed.
const LIMITS = {
  google: { headline: 30, description: 90, path: 15 },
  meta: { headline: 40, primary_text: 125, description: 30 },
  linkedin: { headline: 70, primary_text: 150 },
};
const CTA = {
  meta: ['SIGN_UP', 'LEARN_MORE', 'GET_STARTED', 'DOWNLOAD'],
  linkedin: ['SIGN_UP', 'LEARN_MORE', 'REGISTER', 'DOWNLOAD', 'TRY_NOW'],
};

const FIELDS = ['name', 'persona', 'language', 'platform', 'format', 'headline', 'primary_text', 'description', 'cta', 'creative_url',
  'landing_url', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'keywords', 'interests', 'countries',
  'cities', 'age_min', 'age_max', 'budget_daily_usd', 'start', 'end', 'signoffs', 'notes'];

function clean(body) {
  const out = {};
  for (const k of FIELDS) {
    if (body[k] === undefined) continue;
    const v = body[k];
    if (k === 'signoffs') out[k] = Object.fromEntries(SIGNOFFS.map((s) => [s, !!(v && v[s])]));
    else out[k] = typeof v === 'string' ? v.slice(0, 2000) : v;
  }
  return out;
}

const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\n]/)).map((x) => String(x).trim()).filter(Boolean);
const iso = /^\d{4}-\d{2}-\d{2}$/;

function finalUrl(p) {
  try {
    const u = new URL(p.landing_url);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) if (p[k]) u.searchParams.set(k, p[k]);
    return u.toString();
  } catch (e) { return ''; }
}

// Checklist: every item says what passed or what to fix.
function validate(p) {
  const checks = [];
  const add = (ok, item, fix) => checks.push({ ok: !!ok, item, fix: ok ? '' : fix });
  const L = LIMITS[p.platform] || {};
  const cap = Number(process.env.AD_BUDGET_CAP_USD || 50);

  add(PLATFORMS.includes(p.platform), 'Platform is Google Ads, Meta or LinkedIn', 'Choose google, meta or linkedin.');
  add(PERSONAS[p.persona], 'Persona is one of the 13 (p01 to p13)', 'Set the persona code, for example p01.');
  add(p.name, 'Piece has a name', 'Give the piece a name.');
  add(LANGS[p.language], 'Language set (Spanish or English)', 'Choose the language of the copy; Spanish versions go first.');
  add(p.headline, 'Headline present', 'Add a headline.');
  if (p.headline && L.headline) add(p.headline.length <= L.headline, `Headline fits ${L.headline} characters`, `Headline has ${p.headline.length} characters; cut it to ${L.headline}.`);
  if (p.platform !== 'google') {
    add(p.primary_text, 'Primary text present', 'Add the primary text.');
    if (p.primary_text && L.primary_text) add(p.primary_text.length <= L.primary_text, `Primary text shows in full (${L.primary_text} characters)`, `Primary text has ${p.primary_text.length} characters; above ${L.primary_text} it gets cut with "See more".`);
    add(p.creative_url, 'Creative (image or video) attached', 'Add the link to the approved creative.');
    add(!CTA[p.platform] || CTA[p.platform].includes(p.cta), 'Call to action is valid for the platform', `Use one of: ${(CTA[p.platform] || []).join(', ')}.`);
  } else {
    add(p.description, 'Description present', 'Add the description.');
    if (p.description) add(p.description.length <= L.description, `Description fits ${L.description} characters`, `Description has ${p.description.length} characters; cut it to ${L.description}.`);
    add(list(p.keywords).length >= 3, 'At least 3 keywords', 'Add 3 or more keywords from the Research keyword list.');
  }
  let urlOk = false;
  try { const u = new URL(p.landing_url); urlOk = u.protocol === 'https:' && /(^|\.)think4ever\.com$/.test(u.hostname); } catch (e) { /* invalid */ }
  add(urlOk, 'Landing page is https on think4ever.com', 'Use the https landing on go.think4ever.com or think4ever.com.');
  add(p.utm_source && p.utm_medium && p.utm_campaign, 'utm_source, utm_medium and utm_campaign present', 'Fill the three UTM fields with the campaign naming.');
  add(p.utm_content === p.persona, 'utm_content carries the persona code', `Set utm_content to ${p.persona || 'the persona code'} so the dashboard measures by persona.`);
  add(list(p.countries).length > 0, 'Target country set', 'Set at least one country (CO for Colombia).');
  const b = Number(p.budget_daily_usd);
  add(b > 0 && b <= cap, `Daily budget between 0 and the cap (USD ${cap})`, `Set a daily budget above 0 and at most USD ${cap}; leadership raises the cap.`);
  add(iso.test(p.start || '') && (!p.end || (iso.test(p.end) && p.end >= p.start)), 'Start and end dates valid', 'Use YYYY-MM-DD; the end cannot be before the start.');
  const so = p.signoffs || {};
  add(SIGNOFFS.every((s) => so[s]), 'Three approvals (Community Manager, Advertising, Leadership)', `Missing approval: ${SIGNOFFS.filter((s) => !so[s]).map((s) => SIGNOFF_NAMES[s]).join(', ')}.`);
  const by = p.signed_by || {};
  const signers = SIGNOFFS.filter((s) => so[s] && by[s]).map((s) => by[s]);
  add(!signers.includes(p.created_by) && new Set(signers).size === signers.length, 'Approvals from people other than the one who loaded it, one person each', 'Ask a different person for each approval; whoever loads the piece does not approve it.');
  return { ok: checks.every((c) => c.ok), passed: checks.filter((c) => c.ok).length, total: checks.length, checks };
}

const micros = (usd) => Math.round(Number(usd || 0) * 1e6);
const cents = (usd) => Math.round(Number(usd || 0) * 100);
const ymd = (d) => (d || '').replace(/-/g, '');

// Payloads in the shape each API expects. IDs in angle brackets are filled in when the accounts exist.
function payloads(p) {
  const url = finalUrl(p);
  const camp = `${p.utm_campaign || 'campaign'} | ${p.persona || 'pXX'}`;
  if (p.platform === 'google') {
    const cust = process.env.GOOGLE_ADS_CUSTOMER_ID || '<customer_id>';
    return {
      api: 'Google Ads API v17, googleAds:mutate',
      endpoint: `POST https://googleads.googleapis.com/v17/customers/${cust}/googleAds:mutate`,
      body: {
        mutateOperations: [
          { campaignBudgetOperation: { create: { resourceName: `customers/${cust}/campaignBudgets/-1`, name: `${camp} budget`, amountMicros: micros(p.budget_daily_usd), deliveryMethod: 'STANDARD' } } },
          { campaignOperation: { create: { resourceName: `customers/${cust}/campaigns/-2`, name: camp, status: 'PAUSED', advertisingChannelType: 'SEARCH', campaignBudget: `customers/${cust}/campaignBudgets/-1`, manualCpc: {}, startDate: ymd(p.start), endDate: ymd(p.end) || undefined, networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false } } } },
          { adGroupOperation: { create: { resourceName: `customers/${cust}/adGroups/-3`, campaign: `customers/${cust}/campaigns/-2`, name: `${p.name} | ${p.persona}`, status: 'PAUSED', type: 'SEARCH_STANDARD' } } },
          { adGroupAdOperation: { create: { adGroup: `customers/${cust}/adGroups/-3`, status: 'PAUSED', ad: { finalUrls: [url], responsiveSearchAd: { headlines: [{ text: p.headline }], descriptions: [{ text: p.description }] } } } } },
          ...list(p.keywords).map((k) => ({ adGroupCriterionOperation: { create: { adGroup: `customers/${cust}/adGroups/-3`, status: 'ENABLED', keyword: { text: k, matchType: 'PHRASE' } } } })),
          ...list(p.countries).map((c) => ({ campaignCriterionOperation: { create: { campaign: `customers/${cust}/campaigns/-2`, location: { geoTargetConstant: `geoTargetConstants/<${c}>` } } } })),
        ],
      },
      note: 'A responsive search ad needs 3 to 15 headlines and 2 to 4 descriptions to serve; add variants before going live.',
    };
  }
  if (p.platform === 'meta') {
    const act = process.env.META_AD_ACCOUNT_ID || '<ad_account_id>';
    return {
      api: 'Meta Marketing API v19',
      steps: [
        { endpoint: `POST https://graph.facebook.com/v19.0/act_${act}/campaigns`, body: { name: camp, objective: 'OUTCOME_LEADS', status: 'PAUSED', special_ad_categories: [] } },
        { endpoint: `POST https://graph.facebook.com/v19.0/act_${act}/adsets`, body: { name: `${p.name} | ${p.persona}`, campaign_id: '<from step 1>', daily_budget: cents(p.budget_daily_usd), billing_event: 'IMPRESSIONS', optimization_goal: 'LINK_CLICKS', status: 'PAUSED', start_time: `${p.start}T00:00:00-0500`, end_time: p.end ? `${p.end}T23:59:00-0500` : undefined, targeting: { geo_locations: { countries: list(p.countries) }, age_min: Number(p.age_min || 18), age_max: Number(p.age_max || 65), flexible_spec: list(p.interests).length ? [{ interests: list(p.interests).map((i) => ({ id: '<interest_id>', name: i })) }] : undefined } } },
        { endpoint: `POST https://graph.facebook.com/v19.0/act_${act}/adcreatives`, body: { name: p.name, object_story_spec: { page_id: process.env.META_PAGE_ID || '<page_id>', link_data: { link: url, message: p.primary_text, name: p.headline, description: p.description || undefined, picture: p.creative_url, call_to_action: { type: p.cta || 'LEARN_MORE', value: { link: url } } } } } },
        { endpoint: `POST https://graph.facebook.com/v19.0/act_${act}/ads`, body: { name: p.name, adset_id: '<from step 2>', creative: { creative_id: '<from step 3>' }, status: 'PAUSED' } },
      ],
      note: 'Interest names are matched to Meta interest IDs with the targeting search endpoint before sending.',
    };
  }
  const acct = process.env.LINKEDIN_AD_ACCOUNT_ID || '<ad_account_id>';
  return {
    api: 'LinkedIn Marketing API (rest, versioned)',
    steps: [
      { endpoint: `POST https://api.linkedin.com/rest/adAccounts/${acct}/adCampaignGroups`, body: { account: `urn:li:sponsoredAccount:${acct}`, name: p.utm_campaign || 'campaign group', status: 'PAUSED', runSchedule: { start: Date.parse(p.start) || null } } },
      { endpoint: `POST https://api.linkedin.com/rest/adAccounts/${acct}/adCampaigns`, body: { account: `urn:li:sponsoredAccount:${acct}`, campaignGroup: '<from step 1>', name: camp, type: 'SPONSORED_UPDATES', costType: 'CPM', dailyBudget: { amount: String(Number(p.budget_daily_usd || 0).toFixed(2)), currencyCode: 'USD' }, locale: { country: 'US', language: 'en' }, status: 'PAUSED', runSchedule: { start: Date.parse(p.start) || null, end: p.end ? Date.parse(p.end) : undefined }, targetingCriteria: { include: { and: [{ or: { 'urn:li:adTargetingFacet:locations': list(p.countries).map((c) => `urn:li:geo:<${c}>`) } }, { or: { 'urn:li:adTargetingFacet:titles': [`<job titles for ${PERSONAS[p.persona] || 'persona'}>`] } }] } } } },
      { endpoint: 'POST https://api.linkedin.com/rest/posts', body: { author: `urn:li:organization:${process.env.LINKEDIN_ORG_ID || '129864039'}`, commentary: p.primary_text, visibility: 'PUBLIC', distribution: { feedDistribution: 'NONE' }, content: { article: { source: url, title: p.headline, thumbnail: p.creative_url } }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false } },
      { endpoint: `POST https://api.linkedin.com/rest/adAccounts/${acct}/creatives`, body: { campaign: '<from step 2>', content: { reference: '<post urn from step 3>' }, intendedStatus: 'PAUSED' } },
    ],
    note: 'Targeting by job title is filled with the CIUO/ISCO occupations of the persona from the Research brief.',
  };
}

function liveReady(platform) {
  if (process.env.AD_LOADER_LIVE !== '1') return { ready: false, why: 'Test mode: payloads are built but not sent (AD_LOADER_LIVE is not 1).' };
  const need = { google: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_REFRESH_TOKEN'], meta: ['META_TOKEN', 'META_AD_ACCOUNT_ID', 'META_PAGE_ID'], linkedin: ['LINKEDIN_TOKEN', 'LINKEDIN_AD_ACCOUNT_ID'] }[platform] || [];
  const missing = need.filter((v) => !process.env[v]);
  return missing.length ? { ready: false, why: `Missing service variables: ${missing.join(', ')}.` } : { ready: true, why: '' };
}

// Example pieces so the tool opens in a working state. Marked as examples; they never go to a platform.
const EXAMPLES = [
  { name: 'EXAMPLE · Developers · "Tu IA no vuelve a perder el objetivo"', persona: 'p01', language: 'es', platform: 'linkedin', format: 'single image', headline: 'Tu IA no vuelve a perder el objetivo', primary_text: 'Diseña en Think4Ever y construye con el Claude o Codex que ya pagas. El plano de tu sistema, siempre a la mano de tu IA.', cta: 'SIGN_UP', creative_url: 'https://go.think4ever.com/latam', landing_url: 'https://go.think4ever.com/latam', utm_source: 'linkedin', utm_medium: 'paid_social', utm_campaign: 'latam_co_launch', utm_content: 'p01', countries: 'CO', budget_daily_usd: 20, start: '2026-10-20', end: '2026-11-03', signoffs: { community: true, advertising: true, management: false }, example: true },
  { name: 'EXAMPLE · Designers · "Tu diseño ya es la app"', persona: 'p05', language: 'es', platform: 'meta', format: 'single image', headline: 'Tu diseño ya es la app', primary_text: 'Diseñas tú; la IA construye exactamente lo que diseñaste. Prueba Think4Ever gratis.', cta: 'SIGN_UP', creative_url: 'https://go.think4ever.com/latam', landing_url: 'https://go.think4ever.com/latam', utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'latam_co_launch', utm_content: 'p05', interests: 'Graphic design, User experience design, Figma', countries: 'CO', age_min: 22, age_max: 45, budget_daily_usd: 15, start: '2026-10-20', end: '2026-11-03', signoffs: { community: true, advertising: true, management: true }, example: true },
  { name: 'EXAMPLE · Developers · search "claude code en español"', persona: 'p01', language: 'es', platform: 'google', format: 'responsive search ad', headline: 'Claude Code con plano vivo', description: 'Diseña tu sistema en Think4Ever y deja que tu IA lo siga. Prueba gratis.', landing_url: 'https://go.think4ever.com/latam', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'latam_co_launch', utm_content: 'p1', keywords: 'claude code en español, contexto para ia en programación, servidor mcp', countries: 'CO', budget_daily_usd: 25, start: '2026-10-20', end: '2026-11-03', signoffs: { community: false, advertising: true, management: false }, example: true },
];

// Fields that change what goes out. Editing any of them after an approval clears the approvals.
const CONTENT = FIELDS.filter((k) => !['signoffs', 'notes', 'name'].includes(k));

module.exports = { PERSONAS, PLATFORMS, SIGNOFFS, SIGNOFF_NAMES, LANGS, CONTENT, LIMITS, clean, validate, payloads, liveReady, finalUrl, EXAMPLES };
