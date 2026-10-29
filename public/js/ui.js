'use strict';
/* Formatting, dates, shared UI blocks (KPI tiles, cards, tables, pills), toast, confirm dialog and team code prompt. */
(function (A) {
  const U = A.ui = {};
  const esc = U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.num = (n) => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n));
  U.fmt = (n) => {
    if (!U.num(n)) return '–';
    const v = Number(n);
    return v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 1000 && v % 1 ? 1 : 0 });
  };
  U.pct = (n, d) => (!U.num(n) ? '–' : `${(Number(n) * 100).toFixed(d == null ? (Math.abs(n) < 0.1 && Number(n) !== 0 ? 2 : 1) : d)}%`);
  U.money = (n) => (!U.num(n) ? '–' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: Math.abs(n) < 1000 ? 2 : 0, maximumFractionDigits: 2 })}`);
  U.value = (kind, n) => (kind === 'rate' ? U.pct(n) : kind === 'money' ? U.money(n) : U.fmt(n));

  // ---------- dates (ISO yyyy-mm-dd strings)
  U.today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  U.addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  // Keep the day-of-month when it exists in the target month; otherwise clamp to that month's last day.
  U.addMonths = (iso, n) => {
    const d = new Date(`${iso}T12:00:00Z`);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, dim));
    return d.toISOString().slice(0, 10);
  };
  U.monthStart = (iso) => `${String(iso || '').slice(0, 7)}-01`;
  U.diffDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  U.days = (from, to) => { const out = []; for (let d = from; d <= to && out.length < 1200; d = U.addDays(d, 1)) out.push(d); return out; };
  U.months = (from, to) => {
    const out = [];
    let m = String(from || '').slice(0, 7);
    const end = String(to || '').slice(0, 7);
    while (m && m <= end && out.length < 36) {
      out.push(m);
      const [y, mo] = m.split('-').map(Number);
      const ny = mo === 12 ? y + 1 : y;
      const nm = mo === 12 ? 1 : mo + 1;
      m = `${ny}-${String(nm).padStart(2, '0')}`;
    }
    return out;
  };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  U.dshort = (iso) => (iso ? `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}` : '');
  U.win = (a, b) => (!a ? '' : a === b ? U.dshort(a) : `${U.dshort(a)} – ${U.dshort(b)}`);
  U.monthName = (m) => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
  U.endOfMonth = (m) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };
  // Monday of the ISO week that contains this day.
  U.monday = (iso) => {
    const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
    return U.addDays(iso, day === 0 ? -6 : 1 - day);
  };
  // Bucket keys: day yyyy-mm-dd, week W+Monday, bi-week B+start, month yyyy-mm, quarter yyyy-Q#, year yyyy.
  // Bi-weeks are 14 days from the Monday of the week that contains the anchor (launch).
  U.bucketKey = (iso, grain, anchor) => {
    if (grain === 'week') return `W${U.monday(iso)}`;
    if (grain === 'biweek') {
      const origin = U.monday(anchor || iso);
      const steps = Math.floor(U.diffDays(origin, U.monday(iso)) / 14);
      return `B${U.addDays(origin, steps * 14)}`;
    }
    if (grain === 'month') return String(iso).slice(0, 7);
    if (grain === 'quarter') return `${iso.slice(0, 4)}-Q${Math.ceil(+iso.slice(5, 7) / 3)}`;
    if (grain === 'year') return String(iso).slice(0, 4);
    return iso;
  };
  U.grainOf = (key) => {
    const s = String(key || '');
    if (/^\d{4}$/.test(s)) return 'year';
    if (/^\d{4}-Q[1-4]$/.test(s)) return 'quarter';
    if (/^\d{4}-\d{2}$/.test(s)) return 'month';
    if (s.startsWith('B')) return 'biweek';
    if (s.startsWith('W')) return 'week';
    return 'day';
  };
  U.bucketSpan = (key) => {
    const g = U.grainOf(key);
    if (g === 'week' || g === 'biweek') { const start = key.slice(1); return { start, end: U.addDays(start, g === 'week' ? 6 : 13) }; }
    if (g === 'month') return { start: `${key}-01`, end: U.endOfMonth(key) };
    if (g === 'quarter') {
      const y = key.slice(0, 4), q = +key.slice(6), m = (q - 1) * 3 + 1;
      const start = `${y}-${String(m).padStart(2, '0')}-01`;
      return { start, end: U.endOfMonth(`${y}-${String(m + 2).padStart(2, '0')}`) };
    }
    if (g === 'year') return { start: `${key}-01-01`, end: `${key}-12-31` };
    return { start: key, end: key };
  };
  // One tick per bucket that overlaps from..to, in order. Days with no rows still count, so an empty month stays visible.
  U.ticks = (from, to, grain, anchor) => {
    const out = [];
    let last = '';
    for (const d of U.days(from, to)) {
      const k = U.bucketKey(d, grain, anchor);
      if (k !== last) { out.push(k); last = k; }
    }
    return out;
  };
  // Axis label clipped to the dashboard window, so a week that starts before launch reads from launch day.
  U.axis = (key) => {
    if (!key) return '';
    const g = U.grainOf(key);
    if (g === 'month') return `${MON[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;
    if (g === 'quarter') return `Q${key.slice(6)} ${key.slice(0, 4)}`;
    if (g === 'year') return String(key);
    if (g === 'day') return U.dshort(key);
    const span = U.bucketSpan(key);
    const from = (A.S && A.S.from) || span.start;
    const to = (A.S && A.S.to) || span.end;
    const a = span.start < from ? from : span.start;
    const b = span.end > to ? to : span.end;
    if (a.slice(0, 7) === b.slice(0, 7)) return `${MON[+a.slice(5, 7) - 1]} ${+a.slice(8)}–${+b.slice(8)}`;
    return `${U.dshort(a)}–${U.dshort(b)}`;
  };
  U.stamp = (s) => String(s || '').slice(0, 16).replace('T', ' ');

  U.icon = (name, style = 'fa-solid', cls = '') => `<i class="${style} fa-${name}${cls ? ' ' + cls : ''}" aria-hidden="true"></i>`;

  U.toast = (text, kind = '') => {
    const el = document.getElementById('toast');
    el.innerHTML = `${U.icon(kind === 'error' ? 'circle-exclamation' : 'circle-check')}<span>${esc(text)}</span>`;
    el.className = `toast show ${kind}`;
    clearTimeout(U.toastTimer);
    U.toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  };

  // % change vs previous period; costs pass invert so that a drop reads as good.
  U.delta = (cur, prev, opts = {}) => {
    if (!U.num(prev) || !U.num(cur)) return '<span class="delta delta-neutral" title="No comparison for this period">–</span>';
    if (!Number(prev)) return Number(cur) ? '<span class="delta delta-neutral">new</span>' : '<span class="delta delta-neutral">0.0%</span>';
    const ch = (cur - prev) / Math.abs(prev), up = ch >= 0, good = opts.invert ? !up : up;
    const cls = Math.abs(ch) < 0.0005 ? 'delta-neutral' : good ? 'delta-up' : 'delta-down';
    const a = (Math.abs(ch) * 100).toFixed(1);
    return `<span class="delta ${cls}" title="${up ? 'Up' : 'Down'} ${a}% vs previous period">${U.icon(up ? 'arrow-up' : 'arrow-down')}${up ? '+' : '−'}${a}%</span>`;
  };
  U.spark = (vals) => {
    const v = (vals || []).map((x) => Number(x) || 0), n = v.length, w = 96, h = 30;
    if (n < 2 || !v.some(Boolean)) return '';
    const mx = Math.max(...v), mn = Math.min(...v), rg = mx - mn || 1;
    const pts = v.map((y, i) => [((i / (n - 1)) * (w - 4) + 2).toFixed(1), (h - 3 - ((y - mn) / rg) * (h - 8)).toFixed(1)]);
    const line = pts.map((p) => p.join(',')).join(' '), last = pts[n - 1];
    return `<svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" overflow="hidden" aria-hidden="true"><polygon class="area" points="2,${h} ${line} ${w - 2},${h}"/><polyline class="line" points="${line}"/><circle class="last" cx="${last[0]}" cy="${last[1]}" r="2.4"/></svg>`;
  };
  U.kpi = (o) => {
    const top = `<div class="kpi-label">${esc(o.label)}<span class="kpi-source">${esc(o.source || '')}</span></div>`;
    if (o.awaiting) {
      return `<div class="kpi-tile">${top}<div class="kpi-awaiting">Awaiting ${esc(o.awaiting)}</div><div class="kpi-compare">${o.compare ? o.compare : `No data yet: connect ${esc(o.awaiting)} on Data Sources`}</div></div>`;
    }
    return `<div class="kpi-tile${o.cls ? ` ${o.cls}` : ''}">${top}<div class="kpi-value${o.hero ? ' hero' : ''}${o.small ? ' small' : ''}" title="${esc(String(o.value).replace(/<[^>]+>/g, ''))}">${o.value}</div><div class="kpi-foot">${o.delta || ''}${o.spark ? U.spark(o.spark) : ''}</div><div class="kpi-compare">${o.compare || ''}</div></div>`;
  };
  U.kpiRow = (tiles, cols) => `<div class="kpi-row${cols ? ` cols-${cols}` : ''}">${tiles.filter(Boolean).join('')}</div>`;
  U.section = (title, sub, body, right = '') => `<section class="section"><div class="section-head"><div><h2 class="section-title">${esc(title)}</h2>${sub ? `<p class="section-sub">${sub}</p>` : ''}</div>${right}</div>${body}</section>`;
  U.card = (o) => `<section class="card ${o.cls || ''}"${o.id ? ` id="${o.id}"` : ''}><div class="card-header"><div><div class="card-title">${esc(o.title)}</div>${o.sub ? `<div class="card-sub">${o.sub}</div>` : ''}</div>${o.right || ''}</div>${o.body || ''}</section>`;
  U.pill = (kind, text, dot) => `<span class="pill pill-${kind}">${dot ? '<span class="dot"></span>' : ''}${esc(text)}</span>`;
  const STATE = { connected: ['success', 'Connected'], pending: ['warning', 'Access pending'], not_started: ['neutral', 'Not started'] };
  U.statePill = (state) => { const [k, t] = STATE[state] || ['neutral', state || 'Unknown']; return U.pill(k, t, true); };
  U.srcPill = (key, extra) => {
    const s = A.D.source(key);
    return `<span class="pill ${s.state === 'connected' ? 'pill-neutral' : 'pill-warning'}"><span class="dot"></span>${esc(s.name || key)}${extra ? ` · ${esc(extra)}` : ''}</span>`;
  };
  U.awaiting = (key, what) => {
    const s = A.D.source(key);
    return `<div class="empty-state">${U.icon('plug-circle-exclamation')}<b>No data yet: connect ${esc(s.name || key)}</b><span>${esc(what || s.provides || '')}</span>${s.note ? `<small>${esc(s.note)}</small>` : ''}<button type="button" class="btn btn-secondary btn-sm" data-go="sources">${U.icon('database')} Open Data Sources</button></div>`;
  };
  U.empty = (title, text, icon = 'inbox') => `<div class="empty-state slim">${U.icon(icon)}<b>${esc(title)}</b>${text ? `<span>${text}</span>` : ''}</div>`;
  U.table = (cols, rows, rowCls = () => '') => `<div class="tbl-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.num ? 'td-num' : ''}">${esc(c.t)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr class="${rowCls(r, i)}">${cols.map((c) => `<td class="${c.num ? 'td-num' : ''}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  U.details = (title, count, body, open) => `<details class="collapsible"${open ? ' open' : ''}><summary>${U.icon('chevron-right', 'fa-solid', 'chev')}${esc(title)}${count != null && count !== '' ? `<span class="count">${esc(count)}</span>` : ''}</summary><div class="collapsible-body">${body}</div></details>`;
  U.download = (name, text, type = 'text/csv') => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  U.confirm = (message, okText = 'Confirm', danger = true) => new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><p class="modal-text">${esc(message)}</p><div class="modal-actions"><button type="button" class="btn btn-secondary" data-m="0">Cancel</button><button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-m="1">${esc(okText)}</button></div></div></div>`;
    const done = (v) => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (b) done(b.dataset.m === '1'); else if (e.target.classList.contains('modal-backdrop')) done(false);
    });
    root.querySelector('[data-m="1"]').focus();
  });
  U.askCode = () => {
    const v = document.getElementById('view');
    v.innerHTML = `<section class="card code-card fade-in"><div class="card-header"><div><div class="card-title">${U.icon('key')} Team code</div><div class="card-sub">This dashboard asks for the team code. Ask the Research lead for it.</div></div></div>
      <form id="code-form" class="form-row"><input type="password" id="code-in" class="grow" aria-label="Team code" placeholder="Team code" required><button class="btn btn-primary">${U.icon('lock-open')} Open</button></form></section>`;
    v.querySelector('#code-form').addEventListener('submit', (e) => {
      e.preventDefault();
      A.store('t4e-growth-code', v.querySelector('#code-in').value);
      A.load();
    });
    v.querySelector('#code-in').focus();
  };
})(window.App);
