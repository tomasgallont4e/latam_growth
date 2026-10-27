'use strict';
// Username and password login. Credentials come only from the service variables:
//   DASH_USERS      "user1:password1,user2:password2" (one or more users)
//   SESSION_SECRET  random text used to sign the session cookie (if missing, it is derived from DASH_USERS)
// If DASH_USERS is not set, the app stays locked: nobody gets in without credentials.
const crypto = require('crypto');

const COOKIE = 't4e_growth_sess';
const DAYS = Number(process.env.SESSION_DAYS || 30);
const OPEN = new Set(['/login', '/login.html', '/app.css', '/api/login', '/health', '/api/health', '/favicon.ico']);

// Roles: admin (Research, everything), read (view only), ads (view plus the ad loader).
// Format: "user:password:role"; a user without a role is admin, as before roles existed.
const ROLES = ['admin', 'read', 'ads'];
function accounts() {
  const raw = process.env.DASH_USERS || '';
  const out = new Map();
  for (const entry of raw.split(',')) {
    const i = entry.indexOf(':');
    if (i <= 0) continue;
    let pass = entry.slice(i + 1).trim(), role = 'admin';
    const j = pass.lastIndexOf(':');
    if (j > 0 && ROLES.includes(pass.slice(j + 1).trim())) { role = pass.slice(j + 1).trim(); pass = pass.slice(0, j); }
    if (pass) out.set(entry.slice(0, i).trim(), { pass, role });
  }
  return out;
}
const users = () => new Map([...accounts()].map(([u, a]) => [u, a.pass]));
const roleOf = (u) => (accounts().get(u) || {}).role;
const configured = () => users().size > 0;
const secret = () => process.env.SESSION_SECRET || crypto.createHash('sha256').update('t4e-growth|' + (process.env.DASH_USERS || '')).digest('hex');

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const good = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Date.now() || !users().has(p.u)) return null;
    return p;
  } catch (e) { return null; }
}
function readCookie(req) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : '';
}
function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Simple brute-force brake: 8 failed attempts per IP in 15 minutes.
const fails = new Map();
function blocked(ip) {
  const all = fails.get('*');
  if (all && Date.now() - all.since <= 15 * 60e3 && all.n >= 60) return true;
  const f = fails.get(ip);
  if (!f) return false;
  if (Date.now() - f.since > 15 * 60e3) { fails.delete(ip); return false; }
  return f.n >= 8;
}
function failed(ip) {
  for (const k of [ip, '*']) {
    const f = fails.get(k) && Date.now() - fails.get(k).since <= 15 * 60e3 ? fails.get(k) : { n: 0, since: Date.now() };
    f.n += 1; fails.set(k, f);
  }
}

function cookieAttrs(req, maxAgeSec) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

function mount(app) {
  app.post('/api/login', (req, res) => {
    const ip = req.ip || 'x';
    if (!configured()) return res.status(503).json({ error: 'not_configured' });
    if (blocked(ip)) return res.status(429).json({ error: 'too_many' });
    const { user, password } = req.body || {};
    const pass = users().get(String(user || '').trim());
    if (!pass || !sameText(pass, password || '')) { failed(ip); return res.status(401).json({ error: 'wrong' }); }
    fails.delete(ip);
    const token = sign({ u: String(user).trim(), exp: Date.now() + DAYS * 864e5 });
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; ${cookieAttrs(req, DAYS * 86400)}`);
    res.json({ ok: true, user: String(user).trim() });
  });
  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(req, 0)}`);
    res.json({ ok: true });
  });
  // Everything else needs a valid session.
  app.use((req, res, next) => {
    if (OPEN.has(req.path)) return next();
    const s = verify(readCookie(req));
    if (s) {
      req.user = s.u; req.role = roleOf(s.u);
      // Writes by role: read changes nothing; ads only works in the ad loader; admin does everything.
      const write = req.method !== 'GET' && req.method !== 'HEAD' && req.path !== '/api/logout';
      // Monthly targets (memory #113): every signed-in user can upload, edit and delete them.
      if (write && req.role !== 'admin' && !(req.role === 'ads' && req.path.startsWith('/api/ads')) && !req.path.startsWith('/api/targets')) {
        return res.status(403).json({ error: 'Your user can view this dashboard but not change it.' });
      }
      return next();
    }
    // Machine loads (daily routine): POST /api/ingest with a matching x-ingest-key passes without a session.
    const ik = process.env.INGEST_KEY;
    if (ik && req.method === 'POST' && req.path === '/api/ingest' && req.get('x-ingest-key') && sameText(req.get('x-ingest-key'), ik)) {
      req.user = 'ingest-key'; req.role = 'ingest'; return next();
    }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: configured() ? 'auth' : 'not_configured' });
    res.redirect('login.html');
  });
  app.get('/api/me', (req, res) => res.json({ user: req.user, role: req.role }));
}

module.exports = { mount, configured };
