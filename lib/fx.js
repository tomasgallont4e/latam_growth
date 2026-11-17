'use strict';
// Ad spend in US dollars.
//
// Every ad account bills in its own currency (the Google Ads account is in CAD), but the
// dashboard shows every amount as US$. Each ad connector reads its account currency from the
// platform and passes its rows through convertSpendToUsd before they are stored, so ad_spend
// and ad_spend_geo are always US dollars and the labels stay true.
//
// Daily rates come from the ECB reference rates (Frankfurter API, no key). A day without a
// published rate (weekends, holidays) uses the last rate before it. FX_RATES_USD
// ("CAD:0.71,EUR:1.08") is a fixed fallback for when the API is down or the currency is not
// an ECB currency. Without any rate the sync fails instead of storing another currency as US$.

const SPEND_METRICS = new Set(['ad_spend', 'ad_spend_geo']);

const shiftDay = (d, n) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

function fixedRates(env = process.env) {
  const out = {};
  for (const part of String(env.FX_RATES_USD || '').split(',')) {
    const [cur, val] = part.split(':').map((s) => (s || '').trim());
    const n = Number(val);
    if (/^[A-Za-z]{3}$/.test(cur) && n > 0) out[cur.toUpperCase()] = n;
  }
  return out;
}

// series: [[date, rate]] sorted by date. Last rate on or before the date; before the first
// published rate, the first one.
function rateOn(series, date) {
  let rate = series.length ? series[0][1] : null;
  for (const [d, r] of series) {
    if (d > date) break;
    rate = r;
  }
  return rate;
}

async function fetchDailyRates(currency, from, to, http, env = process.env) {
  const base = (env.FX_API_URL || 'https://api.frankfurter.dev/v1').replace(/\/$/, '');
  // A week of margin so a range that starts on a weekend still has the previous rate.
  const res = await http(`${base}/${shiftDay(from, -7)}..${to}?from=${encodeURIComponent(currency)}&to=USD`);
  return Object.entries((res && res.rates) || {})
    .map(([d, r]) => [d, Number(r && r.USD)])
    .filter(([, r]) => r > 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

async function convertSpendToUsd({ metrics, currency, from, to, http, env = process.env }) {
  const cur = String(currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) throw new Error(`ad account currency unknown (${currency || 'empty'}); spend not stored`);
  if (cur === 'USD') {
    return { metrics, snapshot: { key: 'spend_currency', from, to, note: 'Ad spend is billed in USD; no conversion.', rows: [{ currency: 'USD', method: 'none' }] } };
  }
  let series = [];
  let method = 'ecb_daily';
  let error = null;
  try {
    series = await fetchDailyRates(cur, from, to, http, env);
  } catch (e) {
    error = e.message;
  }
  if (!series.length) {
    const fixed = fixedRates(env)[cur];
    if (!fixed) throw new Error(`no ${cur} to USD rate (${error || 'empty rate series'}); set FX_RATES_USD to store spend`);
    series = [[from, fixed]];
    method = 'fixed_env';
  }
  const used = new Map();
  const out = metrics.map((m) => {
    if (!SPEND_METRICS.has(m.metric)) return m;
    const rate = rateOn(series, m.date);
    used.set(m.date, rate);
    return { ...m, value: Math.round(Number(m.value || 0) * rate * 100) / 100 };
  });
  const rates = [...used.values()];
  const note = `Ad spend billed in ${cur}, converted to USD at ${method === 'ecb_daily' ? 'the ECB daily reference rate of each day' : 'the fixed FX_RATES_USD rate'}.`;
  return {
    metrics: out,
    snapshot: {
      key: 'spend_currency', from, to, note,
      rows: [{ currency: cur, method, rate_min: rates.length ? Math.min(...rates) : null, rate_max: rates.length ? Math.max(...rates) : null }],
    },
  };
}

module.exports = { convertSpendToUsd, rateOn, fixedRates, SPEND_METRICS };
