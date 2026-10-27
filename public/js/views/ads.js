'use strict';
/* Ad loader (task 124): same data, same api/ads calls and the same approval rules as before; new look. */
(function (A) {
  const U = A.ui, esc = U.esc;
  const PLAT = { google: 'Google Ads', meta: 'Meta', linkedin: 'LinkedIn' };
  const SIGN = { community: 'Community Manager', advertising: 'Advertising', management: 'Leadership' };
  const AD = { data: null, sel: null, edit: null, payload: null, arch: false, loading: false, error: '' };
  const V = () => document.getElementById('view');
  const head = (t, s, r = '') => `<div class="card-header"><div><div class="card-title">${esc(t)}</div>${s ? `<div class="card-sub">${s}</div>` : ''}</div>${r}</div>`;

  async function loadAds(keepSel = true) {
    if (AD.loading) return;
    AD.loading = true;
    try {
      AD.data = await A.api('api/ads'); AD.error = '';
      if (!keepSel || !AD.data.pieces.some((p) => p.id === AD.sel)) { AD.sel = null; AD.payload = null; }
      if (AD.sel) AD.payload = await A.api(`api/ads/${encodeURIComponent(AD.sel)}/payload`);
    } catch (e) { if (e.message !== 'code') { AD.error = e.message; U.toast(e.message, 'error'); } }
    finally { AD.loading = false; }
    if (A.S.tab === 'ads') A.render();
  }
  const checkPill = (c) => U.pill(c.ok ? 'success' : c.passed >= c.total - 2 ? 'warning' : 'error', c.ok ? 'Ready' : `${c.total - c.passed} to fix`);
  function adForm(p) {
    const Ad = AD.data, L = Ad.limits[p.platform || 'linkedin'] || {};
    const f = (k, label, o = {}) => {
      const v = p[k] == null ? '' : p[k];
      const max = o.max ? ` data-max="${o.max}"` : '';
      const cnt = o.max ? `<small class="counter" data-count="${k}">${String(v).length} / ${o.max}</small>` : '';
      const input = o.area ? `<textarea name="${k}" rows="${o.rows || 3}"${max}>${esc(v)}</textarea>`
        : o.opts ? `<select name="${k}">${o.opts.map(([val, t]) => `<option value="${esc(val)}"${String(v) === val ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`
        : `<input name="${k}" type="${o.type || 'text'}" value="${esc(v)}"${max}${o.ph ? ` placeholder="${esc(o.ph)}"` : ''}>`;
      return `<label class="${o.wide ? 'wide' : ''}"><span>${esc(label)} ${cnt}</span>${input}${o.hint ? `<small>${o.hint}</small>` : ''}</label>`;
    };
    const isG = p.platform === 'google';
    return `<section class="card section">${head(p.id ? 'Edit piece' : 'New piece', 'Fill what Advertising approved. The checklist updates when you save.')}
    <form id="ad-form" class="ad-form" data-id="${esc(p.id || '')}">
      ${f('name', 'Piece name', { wide: 1, ph: 'Developers · "Tu IA no vuelve a perder el objetivo"' })}
      ${f('platform', 'Platform', { opts: Object.entries(PLAT) })}
      ${f('language', 'Language', { opts: [['', 'Choose…'], ['es', 'Spanish'], ['en', 'English']] })}
      ${f('persona', 'Persona', { opts: [['', 'Choose…'], ...Object.entries(Ad.personas).map(([k, n]) => [k, `${k} · ${n}`])] })}
      ${f('format', 'Format', { ph: isG ? 'responsive search ad' : 'single image, video, carousel' })}
      ${isG ? '' : f('cta', 'Call to action', { opts: [['', 'Choose…'], ...['SIGN_UP', 'LEARN_MORE', 'GET_STARTED', 'REGISTER', 'DOWNLOAD', 'TRY_NOW'].map((c) => [c, c])] })}
      ${f('headline', 'Headline', { wide: 1, max: L.headline })}
      ${isG ? '' : f('primary_text', 'Primary text', { wide: 1, area: 1, max: L.primary_text })}
      ${f('description', isG ? 'Description' : 'Description (optional)', { wide: 1, max: L.description })}
      ${isG ? '' : f('creative_url', 'Creative link (image or video)', { wide: 1, ph: 'https://…' })}
      ${f('landing_url', 'Landing page', { wide: 1, ph: 'https://go.think4ever.com/latam' })}
      ${f('utm_source', 'utm_source', { ph: p.platform || 'linkedin' })}
      ${f('utm_medium', 'utm_medium', { ph: isG ? 'cpc' : 'paid_social' })}
      ${f('utm_campaign', 'utm_campaign', { ph: 'latam_co_launch' })}
      ${f('utm_content', 'utm_content', { ph: 'p01', hint: 'Must be the persona code.' })}
      ${isG ? f('keywords', 'Keywords (one per line or comma)', { wide: 1, area: 1 }) : ''}
      ${p.platform === 'meta' ? f('interests', 'Interests (comma separated)', { wide: 1 }) : ''}
      ${f('countries', 'Countries', { ph: 'CO' })}
      ${f('cities', 'Cities (optional)', { ph: 'Bogotá, Medellín' })}
      ${p.platform === 'meta' ? f('age_min', 'Age from', { type: 'number' }) + f('age_max', 'Age to', { type: 'number' }) : ''}
      ${f('budget_daily_usd', `Daily budget USD (cap ${Ad.budget_cap})`, { type: 'number' })}
      ${f('start', 'Start', { type: 'date' })}
      ${f('end', 'End', { type: 'date' })}
      <p class="wide card-note" style="margin:0">Approvals are given from the piece, after saving, by people other than the one who loaded it. Changing the copy, creative, targeting, budget, dates or links clears them.</p>
      ${f('notes', 'Notes', { wide: 1, area: 1, rows: 2 })}
      <div class="wide form-row"><button class="btn btn-primary">${U.icon('floppy-disk')} ${p.id ? 'Save' : 'Add piece'}</button><button type="button" class="btn btn-secondary" data-ad-cancel>Cancel</button></div>
    </form></section>`;
  }
  function adDetail() {
    const p = AD.data.pieces.find((x) => x.id === AD.sel); if (!p) return '';
    const P = AD.payload;
    const json = P ? JSON.stringify(P.payload, null, 2) : '';
    return `<section class="card section">${head(p.name, `${esc(PLAT[p.platform] || p.platform)} · ${esc(p.persona || 'no persona')}${p.example ? ' · example, never sent' : ''}`, checkPill(p.check))}
      <div class="grid-2">
        <div><h3 class="sub">Checklist (${p.check.passed} of ${p.check.total})</h3>
          <ul class="checklist">${p.check.checks.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}"><b>${U.icon(c.ok ? 'circle-check' : 'circle-xmark')}</b><span>${esc(c.item)}${c.ok ? '' : `<small>${esc(c.fix)}</small>`}</span></li>`).join('')}</ul>
          <h3 class="sub">Final URL</h3><p class="mono-line"><code>${esc(P ? P.final_url : '')}</code> <button type="button" class="btn btn-ghost btn-sm" data-copy="url">${U.icon('copy', 'fa-regular')} Copy</button></p>
          <h3 class="sub">Approvals</h3>${p.example ? '<p class="card-note" style="margin-top:0">Examples are not approved.</p>' : `<div class="approvals">${Object.entries(SIGN).map(([k, t]) => ((p.signoffs || {})[k] ? `<div class="appr on"><b>${U.icon('circle-check')} ${t}</b><small>${esc((p.signed_by || {})[k] || '')}</small><button type="button" class="btn btn-ghost btn-sm" data-ad-unsign="${k}">Withdraw</button></div>` : `<div class="appr"><b>${t}</b><small>pending</small><button type="button" class="btn btn-secondary btn-sm" data-ad-sign="${k}">Approve</button></div>`)).join('')}</div><p class="card-note">Loaded by ${esc(p.created_by || '–')}. That person cannot approve, and each approval comes from a different person.</p>`}
          <h3 class="sub">Sending</h3><p class="card-note" style="margin-top:0">${esc(P ? (P.live.ready ? 'Platform access is set. Sending stays manual until the connector is tested with the real account.' : P.live.why) : '')}</p>
          <div class="form-row mt-16">${p.example ? `<button type="button" class="btn btn-secondary" data-ad-dup="${esc(p.id)}">${U.icon('clone', 'fa-regular')} Use as a starting point</button>` : `<button type="button" class="btn btn-secondary" data-ad-edit="${esc(p.id)}">${U.icon('pen')} Edit</button><button type="button" class="btn btn-secondary" data-ad-arch="${esc(p.id)}">${U.icon(p.status === 'archived' ? 'box-open' : 'box-archive')} ${p.status === 'archived' ? 'Restore' : 'Archive'}</button>`}
            <button type="button" class="btn btn-primary" data-ad-send="${esc(p.id)}"${!p.check.ok || p.example || !(P && P.live.ready) ? ' disabled' : ''}>${U.icon('paper-plane')} Send to ${esc(PLAT[p.platform] || '')} (paused)</button></div></div>
        <div><h3 class="sub">API payload <button type="button" class="btn btn-ghost btn-sm" data-copy="payload">${U.icon('copy', 'fa-regular')} Copy</button></h3>
          <p class="card-note" style="margin:0 0 8px">${esc(P ? P.payload.api : '')}. ${esc(P ? P.payload.note : '')}</p>
          <pre class="payload" id="ad-payload">${esc(json)}</pre>
          ${(p.log || []).length ? `<h3 class="sub">History</h3><ul class="history">${p.log.slice().reverse().map((l) => `<li><span>${esc(U.stamp(l.at))}</span> <b>${esc(l.user)}</b> ${esc(l.action)}</li>`).join('')}</ul>` : ''}</div>
      </div></section>`;
  }
  function render() {
    if (!AD.data) {
      if (AD.error) return `<section class="card">${U.empty('Could not load the ad loader', esc(AD.error), 'triangle-exclamation')}<div style="text-align:center"><button type="button" class="btn btn-secondary" data-ad-retry>${U.icon('rotate')} Try again</button></div></section>`;
      loadAds();
      return `<p class="loading">${U.icon('spinner', 'fa-solid', 'fa-spin')} Loading the ad loader…</p>`;
    }
    const Ad = AD.data;
    const list = Ad.pieces.filter((p) => AD.arch || p.status !== 'archived');
    const real = Ad.pieces.filter((p) => !p.example && p.status !== 'archived');
    const byPlat = Object.keys(PLAT).map((k) => { const r = real.filter((p) => p.platform === k); return [k, r.length, r.filter((p) => p.check.ok).length]; });
    return `<section class="card">${head('Ad loader', 'Approved pieces from Advertising, checked and turned into the Google Ads, Meta and LinkedIn API calls', U.pill(Ad.mode === 'live' ? 'error' : 'info', Ad.mode === 'live' ? 'Live mode' : 'Test mode: nothing is sent', true))}
      <div class="stats">${byPlat.map(([k, n, ok]) => `<div class="stat"><span>${PLAT[k]}</span><b>${ok} / ${n}</b><small>pieces ready · ${esc(Ad.live[k].ready ? 'access set' : 'access pending')}</small></div>`).join('')}</div>
      <p class="card-note">Every campaign is created paused, with a daily budget at or under USD ${Ad.budget_cap}. A piece goes out only with the three sign-offs and a full checklist. Whatever the loader cannot send yet is loaded by hand from the payload or the export.</p>
      <div class="form-row mt-16" style="align-items:center"><button type="button" class="btn btn-primary" data-ad-new>${U.icon('plus')} New piece</button><button type="button" class="btn btn-secondary" data-ad-export>${U.icon('file-export')} Download all payloads (JSON)</button>
        <label class="switch"><input type="checkbox" id="ad-arch"${AD.arch ? ' checked' : ''}> Show archived</label></div></section>
    ${AD.edit ? adForm(AD.edit) : ''}
    <section class="card section">${head('Pieces', `${real.length} active · examples show how a piece looks and are never sent`)}
      ${list.length ? U.table([
        { t: 'Piece', f: (r) => `<button type="button" class="linkish" data-ad-sel="${esc(r.id)}">${esc(r.name)}</button>${r.example ? ` ${U.pill('neutral', 'Example')}` : ''}${r.status === 'archived' ? ` ${U.pill('neutral', 'Archived')}` : ''}` },
        { t: 'Platform', f: (r) => esc(PLAT[r.platform] || r.platform || '–') },
        { t: 'Persona', f: (r) => `<span title="${esc(Ad.personas[r.persona] || '')}">${esc(r.persona || '–')}</span>` },
        { t: 'Sign-offs', f: (r) => Object.keys(SIGN).map((k) => `<span class="signoff-dot ${(r.signoffs || {})[k] ? 'on' : ''}" title="${SIGN[k]}"></span>`).join('') },
        { t: 'Budget/day', num: 1, f: (r) => U.money(r.budget_daily_usd) },
        { t: 'Checklist', f: (r) => checkPill(r.check) },
      ], list, (r) => (r.id === AD.sel ? 'sel' : '')) : U.empty('No pieces yet', 'Add the first one with <b>New piece</b>.', 'rectangle-ad')}</section>
    ${AD.sel ? adDetail() : ''}`;
  }
  function adFromForm(form) {
    const fd = new FormData(form), o = {};
    for (const [k, v] of fd.entries()) if (!k.startsWith('so_')) o[k] = typeof v === 'string' ? v.trim() : v;
    for (const k of ['budget_daily_usd', 'age_min', 'age_max']) if (o[k] !== undefined && o[k] !== '') o[k] = Number(o[k]);
    return o;
  }
  function mount(el) {
    el.addEventListener('submit', async (e) => {
      if (e.target.id !== 'ad-form') return;
      e.preventDefault();
      const id = e.target.dataset.id, body = adFromForm(e.target);
      try {
        const r = await A.api(id ? `api/ads/${encodeURIComponent(id)}` : 'api/ads', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
        const cleared = (r.log || []).slice(-1).some((l) => /approvals cleared/.test(l.action));
        U.toast(cleared ? 'Saved. The approvals were cleared because the piece changed.' : r.check.ok ? 'Saved: ready to load' : `Saved: ${r.check.total - r.check.passed} item(s) to fix`);
        AD.edit = null; AD.sel = r.id; await loadAds();
      } catch (err) { if (err.message !== 'code') U.toast(err.message, 'error'); }
    });
    el.addEventListener('input', (e) => {
      const t = e.target; if (!t.dataset || !t.dataset.max) return;
      const c = el.querySelector(`[data-count="${t.name}"]`);
      if (c) { c.textContent = `${t.value.length} / ${t.dataset.max}`; c.classList.toggle('over', t.value.length > Number(t.dataset.max)); }
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.id === 'ad-arch') { AD.arch = t.checked; A.render(); return; }
      const form = t.closest && t.closest('#ad-form'); if (!form) return;
      if (t.name === 'persona') { const u = form.elements.utm_content; if (u && (!u.value || /^p\d\d$/.test(u.value))) u.value = t.value; }
      if (t.name === 'platform') {
        // The fields change with the platform: keep what was typed and draw the form again.
        const cur = adFromForm(form); const src = form.elements.utm_source;
        if (src && (!src.value || PLAT[src.value])) cur.utm_source = t.value;
        if (!cur.utm_medium || ['cpc', 'paid_social'].includes(cur.utm_medium)) cur.utm_medium = t.value === 'google' ? 'cpc' : 'paid_social';
        AD.edit = { ...AD.edit, ...cur, id: form.dataset.id || undefined }; A.render();
      }
    });
    el.addEventListener('click', async (e) => {
      const a = (k) => e.target.closest(`[data-${k}]`);
      let b;
      if ((b = a('ad-retry'))) { AD.error = ''; loadAds(); return; }
      if ((b = a('ad-new'))) { AD.edit = { platform: 'linkedin', utm_source: 'linkedin', utm_medium: 'paid_social', countries: 'CO', utm_campaign: 'latam_co_launch', landing_url: 'https://go.think4ever.com/latam' }; A.render(); V().querySelector('#ad-form input')?.focus(); return; }
      if ((b = a('ad-cancel'))) { AD.edit = null; A.render(); return; }
      if ((b = a('ad-sel'))) { AD.sel = b.dataset.adSel; AD.edit = null; await loadAds(); V().querySelector('#ad-payload')?.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if ((b = a('ad-edit'))) { AD.edit = { ...AD.data.pieces.find((p) => p.id === b.dataset.adEdit) }; A.render(); V().querySelector('#ad-form')?.scrollIntoView({ behavior: 'smooth' }); return; }
      if ((b = a('ad-dup'))) {
        const { id, check, example, signoffs, signed_by, status, created_by, created_at, updated, updated_by, log, ...rest } = AD.data.pieces.find((p) => p.id === b.dataset.adDup);
        AD.edit = { ...rest, name: rest.name.replace(/^EXAMPLE · /, '') }; A.render(); V().querySelector('#ad-form')?.scrollIntoView({ behavior: 'smooth' }); return;
      }
      if ((b = a('ad-arch'))) {
        const p = AD.data.pieces.find((x) => x.id === b.dataset.adArch);
        try { await A.api(`api/ads/${encodeURIComponent(p.id)}`, { method: 'PUT', body: JSON.stringify({ status: p.status === 'archived' ? 'draft' : 'archived' }) }); U.toast(p.status === 'archived' ? 'Restored' : 'Archived'); await loadAds(); } catch (err) { if (err.message !== 'code') U.toast(err.message, 'error'); }
        return;
      }
      if ((b = a('ad-sign')) || (b = a('ad-unsign'))) {
        const p = AD.data.pieces.find((x) => x.id === AD.sel); const k = b.dataset.adSign || b.dataset.adUnsign;
        try { await A.api(`api/ads/${encodeURIComponent(p.id)}`, { method: 'PUT', body: JSON.stringify({ signoffs: { ...p.signoffs, [k]: !!b.dataset.adSign } }) }); U.toast(b.dataset.adSign ? `Approved as ${SIGN[k]}` : 'Approval withdrawn'); await loadAds(); } catch (err) { if (err.message !== 'code') U.toast(err.message, 'error'); }
        return;
      }
      if ((b = a('ad-send'))) { try { await A.api(`api/ads/${encodeURIComponent(b.dataset.adSend)}/send`, { method: 'POST' }); U.toast('Sent, paused'); } catch (err) { if (err.message !== 'code') U.toast(err.message, 'error'); } return; }
      if ((b = a('copy'))) {
        const txt = b.dataset.copy === 'url' ? AD.payload.final_url : JSON.stringify(AD.payload.payload, null, 2);
        try { await navigator.clipboard.writeText(txt); U.toast('Copied'); } catch (err) { U.toast('Select the text and copy it by hand', 'error'); }
        return;
      }
      if ((b = a('ad-export'))) {
        try { U.download(`ad-loader-payloads-${U.today()}.json`, JSON.stringify(await A.api('api/ads/export'), null, 2), 'application/json'); }
        catch (err) { if (err.message !== 'code') U.toast(err.message, 'error'); }
      }
    });
  }
  A.views.ads = { title: 'Ad loader', render, mount };
})(window.App);
