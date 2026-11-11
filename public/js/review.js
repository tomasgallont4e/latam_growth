'use strict';
/* Reference-layout building blocks (memory #139) shared by Overview and Executive.
   Presentation only: every value comes from the caller. A missing value renders as No data, never as zero. */
(function (A) {
  const U = A.ui;
  const R = A.review = {};

  R.eyebrow = (cutoff) => {
    const today = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date()).toUpperCase();
    return `${today} · ${cutoff ? `DATA THROUGH ${U.dshort(cutoff).toUpperCase()}` : 'NO COMPLETE DAY YET'}`;
  };

  R.head = ({ eyebrow, title, sub, right }) => `<div class="rv-head"><div><div class="rv-eyebrow">${U.esc(eyebrow)}</div><h2 class="rv-title">${U.esc(title)}</h2>${sub ? `<div class="rv-sub">${U.esc(sub)}</div>` : ''}</div>${right ? `<div class="rv-ranges">${right}</div>` : ''}</div>`;

  R.rangeButtons = (active) => [['all', 'Since launch'], ['7', 'Last 7 days'], ['28', 'Last 28 days']]
    .map(([id, label]) => `<button type="button" class="btn btn-secondary btn-sm${active === id ? ' selected' : ''}" data-rv-range="${id}" aria-pressed="${active === id}">${label}</button>`).join('');

  R.status = (kind, text) => {
    const icon = { ok: 'circle-check', warn: 'triangle-exclamation', missing: 'circle-minus', stale: 'clock-rotate-left' }[kind] || 'circle-info';
    return `<span class="rv-st rv-st-${kind}">${U.icon(icon)} ${U.esc(text)}</span>`;
  };

  // "Goal month" dropdown for the 500K goal card (independent of From/To).
  R.goalMonthPicker = (months, active) => `<label class="field rv-goal-pick"><span>Goal month</span><select data-goal-month aria-label="Goal month">${(months || []).map((m) => `<option value="${U.esc(m)}"${m === active ? ' selected' : ''}>${U.esc(U.monthName(m))}</option>`).join('')}</select></label>`;

  R.goal = ({ label, detail, value, goal, note, remainingLabel, control }) => {
    const known = U.num(value) && goal > 0;
    const ratio = known ? Number(value) / goal : null;
    const main = known
      ? `${U.fmt(value)} <small>of ${U.fmt(goal)} · ${A.charts.sharePct(ratio)} of the goal</small>`
      : '<span class="kpi-awaiting">No data yet</span>';
    const remain = known
      ? `<b>${U.fmt(Math.max(0, goal - Number(value)))}</b><span>${U.esc(remainingLabel || 'remaining this month')}</span>`
      : `<b>–</b><span>${goal > 0 ? 'Remaining appears once the count is complete' : 'No goal set in Targets'}</span>`;
    const bar = known ? `<div class="rv-goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100, ratio * 100))}" aria-label="${U.esc(label)}"><i style="width:${Math.min(100, ratio * 100).toFixed(3)}%"></i></div>` : '';
    return `<section class="rv-goal"><div><div class="rv-goal-label">${U.icon('bullseye')} ${U.esc(label)}${detail ? ` <span>· ${U.esc(detail)}</span>` : ''}</div>${control ? `<div class="rv-goal-ctl">${control}</div>` : ''}<strong>${main}</strong>${bar}${note ? `<div class="rv-goal-note">${U.esc(note)}</div>` : ''}</div><div class="rv-remain">${remain}</div></section>`;
  };

  R.mini = (vals) => {
    const v = (vals || []).map((x) => Number(x) || 0);
    const top = Math.max(0, ...v);
    if (!top) return '';
    return `<div class="rv-mini" aria-hidden="true">${v.map((x) => `<i style="height:${Math.max(2, (x / top) * 22).toFixed(1)}px"></i>`).join('')}</div>`;
  };

  R.kpi = (o) => {
    const value = o.value == null ? '<span class="kpi-awaiting">No data yet</span>' : o.value;
    return `<article class="card rv-kpi${o.accent ? ` rv-${o.accent}` : ''}"><div class="rv-kpihead"><b>${U.esc(o.label)}</b><span class="rv-source">${U.esc(o.source || '')}</span></div><div class="rv-value">${value}${o.trend ? ` <span class="rv-trend">${o.trend}</span>` : ''}</div><div class="rv-meta"><span>${o.meta || ''}</span>${o.status ? R.status(o.status.kind, o.status.text) : ''}</div>${o.bars ? R.mini(o.bars) : ''}</article>`;
  };

  R.panel = (o) => `<section class="card rv-panel ${o.cls || ''}"><div class="rv-secthead"><div><b>${U.esc(o.title)}</b>${o.sub ? `<small>${o.sub}</small>` : ''}</div>${o.action || ''}</div>${o.body || ''}${o.caption ? `<div class="rv-caption">${o.caption}</div>` : ''}</section>`;

  R.action = (label, go) => `<button type="button" class="rv-action" data-go="${U.esc(go)}">${U.esc(label)} ${U.icon('arrow-up-right-from-square')}</button>`;

  // Independent scales: each line is drawn against its own peak, so no ratio between sources is implied.
  R.lines = ({ dates, series, label }) => {
    const drawn = (series || []).filter((s) => (s.values || []).some((v) => Number(v) > 0));
    if (!dates.length || !drawn.length) return U.empty('No trend yet', 'The connected sources have no daily rows in this range.', 'chart-line');
    const W = 740, H = 190, L = 12, RR = 12, T = 16, B = 150;
    const last = dates.length - 1;
    const x = (j) => L + (last ? (j * (W - L - RR)) / last : (W - L - RR) / 2);
    let g = '';
    for (let k = 0; k < 4; k++) {
      const yy = (T + (k * (B - T)) / 3).toFixed(1);
      g += `<line class="rv-grid" x1="${L}" x2="${W - RR}" y1="${yy}" y2="${yy}"/>`;
    }
    drawn.forEach((s, i) => {
      const peak = Math.max(...s.values.map((v) => Number(v) || 0)) || 1;
      const pts = s.values.map((v, j) => `${x(j).toFixed(1)},${(B - ((Number(v) || 0) / peak) * (B - T)).toFixed(1)}`);
      if (i === 0) g += `<polygon class="rv-fill" style="fill:${s.color}" points="${x(0).toFixed(1)},${B} ${pts.join(' ')} ${x(last).toFixed(1)},${B}"/>`;
      g += `<polyline class="rv-line" style="stroke:${s.color}" points="${pts.join(' ')}"><title>${U.esc(s.name)} · daily peak ${U.esc(U.fmt(peak))}</title></polyline>`;
    });
    const every = Math.max(1, Math.ceil(dates.length / 6));
    dates.forEach((d, j) => {
      const show = (j % every === 0 && last - j >= every / 2) || j === last;
      if (show) g += `<text class="rv-axis" x="${x(j).toFixed(1)}" y="${H - 12}" text-anchor="${j === 0 ? 'start' : j === last ? 'end' : 'middle'}">${U.esc(U.dshort(d))}</text>`;
    });
    const legend = `<div class="rv-legend">${drawn.map((s) => `<span><i style="background:${s.color}"></i>${U.esc(s.name)}</span>`).join('')}</div>`;
    return `${legend}<svg class="rv-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${U.esc(label)}">${g}</svg>`;
  };

  R.countries = (rows, { label = 'Sign-ups', changeLabel = 'Change', total } = {}) => {
    if (!rows.length) return U.empty('No country data yet', 'The source has not attributed this metric to countries.', 'earth-americas');
    const sum = total || rows.reduce((n, r) => n + (Number(r.value) || 0), 0);
    const body = rows.map((r) => {
      const share = sum && U.num(r.value) ? Number(r.value) / sum : null;
      return `<tr${r.noCountry ? ' class="rv-muted"' : ''}><td>${U.esc(r.country)}${r.note ? ` <small class="text-muted">${U.esc(r.note)}</small>` : ''}</td><td class="td-num">${U.fmt(r.value)}</td><td class="td-num">${r.change || '<span class="text-muted">–</span>'}</td><td class="td-num"><span class="rv-barcell">${share == null ? '–' : U.pct(share, 1)}<i class="rv-track"><i style="width:${share == null ? 0 : Math.min(100, share * 100).toFixed(1)}%"></i></i></span></td></tr>`;
    }).join('');
    return `<div class="tbl-wrap"><table class="rv-table"><thead><tr><th>Country</th><th class="td-num">${U.esc(label)}</th><th class="td-num">${U.esc(changeLabel)}</th><th class="td-num">Share</th></tr></thead><tbody>${body}</tbody></table></div>`;
  };

  R.tabs = (group, items, active) => `<div class="rv-tabs" role="tablist">${items.map(([id, label]) => `<button type="button" role="tab" class="rv-tab${id === active ? ' active' : ''}" aria-selected="${id === active}" data-rv-tab="${group}" data-id="${id}">${U.esc(label)}</button>`).join('')}</div>`;

  // One bar per month, scaled to the best month (a 500K axis would flatten every bar). The goal reads as a percentage.
  R.monthBars = (items, { unit = 'sign-ups' } = {}) => {
    if (!items.length) return U.empty('No months yet', '', 'chart-column');
    const top = Math.max(1, ...items.filter((i) => U.num(i.value)).map((i) => Number(i.value)));
    return `<div class="rv-monthbars">${items.map((i) => {
      const has = U.num(i.value);
      const h = has ? Math.max(2, (Number(i.value) / top) * 100) : 0;
      const pct = has && i.goal > 0 ? A.charts.sharePct(Number(i.value) / i.goal) : null;
      const tip = `${i.label} · ${has ? `${U.fmt(i.value)} ${unit}` : 'No data'}${pct ? ` · ${pct} of ${U.fmt(i.goal)}` : ''}${i.partial ? ' · month in progress' : ''}`;
      return `<div class="rv-month" title="${U.esc(tip)}"><b>${has ? U.fmt(i.value) : 'No data'}</b><i class="${has ? '' : 'rv-empty'}${i.partial ? ' rv-partial' : ''}" style="--h:${h.toFixed(1)}%"></i><span>${U.esc(i.label)}</span><small>${pct ? `${pct} of goal` : i.goal > 0 ? '–' : 'No goal'}</small></div>`;
    }).join('')}</div>`;
  };

  R.coverage = (rows) => `<div class="rv-coverage">${rows.map((r) => `<div class="rv-srcline"><span>${U.esc(r.name)}</span>${R.status(r.kind, r.text)}</div>`).join('')}</div>`;

  // Source state + whether rows exist. A missing feed is Pending or Not connected, never zero.
  R.sourceCoverage = (sources, list) => list.map(({ key, name, has, detail }) => {
    const s = (sources || []).find((x) => x && (x.key === key || x._k === key)) || {};
    const stamp = s.last_sync ? U.dshort(String(s.last_sync).slice(0, 10)) : null;
    const hours = s.last_sync ? (Date.now() - Date.parse(s.last_sync)) / 36e5 : null;
    if (!has && s.state && s.state !== 'connected') return { name, kind: 'missing', text: s.state === 'pending' ? 'Access pending · no rows' : 'Not connected' };
    if (!has) return { name, kind: 'warn', text: 'Pending · no rows' };
    if (Number.isFinite(hours) && hours > 36) return { name, kind: 'stale', text: `Stale · last sync ${stamp}` };
    return { name, kind: 'ok', text: `Loaded${stamp ? ` · ${stamp}` : ''}${detail ? ` · ${detail}` : ''}` };
  });
})(window.App);
