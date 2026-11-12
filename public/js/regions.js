'use strict';
/* World regions (plan 6.4.21). Country names as GA4 and PostHog GeoIP report them, in English.
   The 11 plan countries come from the goal plan, so a plan change moves a country without editing this table.
   A country missing here is reported as unmapped by name, never folded into another region. */
(function (root) {
  const REGIONS = [
    { id: 'latam_other', name: 'Rest of Latin America and Caribbean', countries: ['Venezuela', 'Panama', 'Costa Rica', 'Guatemala', 'Honduras', 'El Salvador', 'Nicaragua', 'Cuba', 'Puerto Rico', 'Jamaica', 'Haiti', 'Trinidad & Tobago', 'Trinidad and Tobago', 'Bahamas', 'Barbados', 'Belize', 'Guyana', 'Suriname', 'French Guiana', 'Guadeloupe', 'Martinique', 'Curaçao', 'Aruba', 'Cayman Islands', 'Saint Lucia', 'St. Lucia', 'Grenada', 'Antigua & Barbuda', 'Antigua and Barbuda', 'Dominica', 'St. Kitts & Nevis', 'St. Vincent & Grenadines', 'Sint Maarten', 'Bermuda', 'Turks & Caicos Islands', 'British Virgin Islands', 'U.S. Virgin Islands', 'Falkland Islands'] },
    { id: 'north_america', name: 'United States and Canada', countries: ['United States', 'Canada'] },
    { id: 'europe', name: 'Europe', countries: ['Spain', 'Portugal', 'France', 'Germany', 'Italy', 'United Kingdom', 'Ireland', 'Netherlands', 'Belgium', 'Luxembourg', 'Switzerland', 'Austria', 'Poland', 'Czechia', 'Czech Republic', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria', 'Greece', 'Croatia', 'Slovenia', 'Serbia', 'Bosnia & Herzegovina', 'Bosnia and Herzegovina', 'Montenegro', 'North Macedonia', 'Albania', 'Kosovo', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Iceland', 'Estonia', 'Latvia', 'Lithuania', 'Ukraine', 'Belarus', 'Moldova', 'Russia', 'Malta', 'Cyprus', 'Andorra', 'Monaco', 'Liechtenstein', 'San Marino', 'Gibraltar'] },
    { id: 'asia_pacific', name: 'Asia Pacific', countries: ['India', 'China', 'Japan', 'South Korea', 'Taiwan', 'Hong Kong', 'Macao', 'Singapore', 'Malaysia', 'Indonesia', 'Philippines', 'Thailand', 'Vietnam', 'Cambodia', 'Laos', 'Myanmar (Burma)', 'Myanmar', 'Bangladesh', 'Pakistan', 'Sri Lanka', 'Nepal', 'Bhutan', 'Mongolia', 'Kazakhstan', 'Uzbekistan', 'Kyrgyzstan', 'Tajikistan', 'Turkmenistan', 'Afghanistan', 'Australia', 'New Zealand', 'Papua New Guinea', 'Fiji', 'Maldives', 'Brunei'] },
    { id: 'mea', name: 'Middle East and Africa', countries: ['Türkiye', 'Turkey', 'Israel', 'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Bahrain', 'Oman', 'Jordan', 'Lebanon', 'Iraq', 'Iran', 'Syria', 'Yemen', 'Palestine', 'Georgia', 'Armenia', 'Azerbaijan', 'Egypt', 'Morocco', 'Algeria', 'Tunisia', 'Libya', 'Nigeria', 'Ghana', 'Kenya', 'Ethiopia', 'South Africa', 'Senegal', "Côte d’Ivoire", "Cote d'Ivoire", 'Cameroon', 'Uganda', 'Tanzania', 'Rwanda', 'Angola', 'Mozambique', 'Zambia', 'Zimbabwe', 'Botswana', 'Namibia', 'Mauritius', 'Madagascar', 'Sudan', 'Benin', 'Togo', 'Mali', 'Burkina Faso', 'Niger', 'Congo - Kinshasa', 'Congo - Brazzaville', 'Gabon', 'Malawi', 'Somalia', 'Cape Verde', 'Equatorial Guinea'] },
  ];
  const UNKNOWN = new Set(['', '(not set)', 'not set', 'unknown', '(other)']);
  const index = new Map(REGIONS.flatMap((r) => r.countries.map((c) => [c.toLowerCase(), r.id])));
  const PLAN = { id: 'latam_plan', name: 'LATAM plan countries' };
  const NONE = { id: 'unknown', name: 'Country not reported' };
  const OFF = { id: 'unmapped', name: 'Not in the region table' };

  // planCountries: the goal plan's country names (Overview's "Of which LATAM").
  function regionOf(country, planCountries) {
    const c = String(country == null ? '' : country).trim();
    if (UNKNOWN.has(c.toLowerCase())) return NONE.id;
    if ((planCountries || []).some((p) => p.toLowerCase() === c.toLowerCase())) return PLAN.id;
    return index.get(c.toLowerCase()) || OFF.id;
  }
  const ORDER = [PLAN, ...REGIONS.map(({ id, name }) => ({ id, name })), NONE, OFF];
  const api = { regionOf, ORDER };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.App.regions = api;
})(typeof window === 'object' ? window : this);
