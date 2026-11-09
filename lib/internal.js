'use strict';
// One internal/test-account rule for every source. A person is internal when their email,
// company or name contains any pattern (case-insensitive). Defaults: think4ever, moadbus, t4e.
// INTERNAL_PATTERNS replaces the defaults; the older INTERNAL_DOMAINS / INTERNAL_COMPANIES
// variables still add patterns so existing deployments keep excluding what they did.
const DEFAULT_PATTERNS = ['think4ever', 'moadbus', 't4e'];
// Patterns are embedded in HogQL, so only plain domain/company characters are accepted.
// At least 3 characters: a one-letter pattern would mark almost everyone internal.
const SAFE = /^[a-z0-9][a-z0-9 .@_-]{2,99}$/;

const list = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const base = list(process.env.INTERNAL_PATTERNS);
const PATTERNS = [...new Set([...(base.length ? base : DEFAULT_PATTERNS), ...list(process.env.INTERNAL_DOMAINS), ...list(process.env.INTERNAL_COMPANIES)])]
  .filter((p) => SAFE.test(p))
  // 'think4ever.com' adds nothing once 'think4ever' is a pattern.
  .filter((p, _, all) => !all.some((q) => q !== p && p.includes(q)));

function isInternal({ email, company, name } = {}) {
  const text = [email, company, name].map((v) => String(v || '').toLowerCase()).join(' ');
  return PATTERNS.some((p) => text.includes(p));
}

// HogQL boolean: any pattern inside email + company + name.
function hogql({ email, company, name }) {
  if (!PATTERNS.length) return 'false';
  const text = `lower(concat(${email}, ' ', ${company}, ' ', ${name}))`;
  return `(${PATTERNS.map((p) => `position(${text}, '${p}') > 0`).join(' OR ')})`;
}

// Person-property filters for saved PostHog funnel queries.
function posthogPersonFilters() {
  return PATTERNS.flatMap((p) => ['email', 'company', 'name'].map((key) => ({ key, type: 'person', operator: 'not_icontains', value: [p] })));
}

module.exports = { PATTERNS, DEFAULT_PATTERNS, isInternal, hogql, posthogPersonFilters };
