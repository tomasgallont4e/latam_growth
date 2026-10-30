
'use strict';
// Sign in with Microsoft (Entra ID, single tenant: think4ever) and the session gate for every page and API.
// Everything comes from the service variables (never hard-coded):
//   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AUTH_REDIRECT_URI,
//   ALLOWED_EMAIL_DOMAIN (default think4ever.com), SESSION_SECRET, SESSION_HOURS (default 10),
//   LEGACY_LOGIN (default false: the old DASH_USERS login only works when it is "true").
// Machine-to-machine loads keep their existing auth: POST api/ingest with a valid x-ingest-key passes
// without a session, exactly as before.
const crypto = require('crypto');
const session = require('express-session');
const msal = require('@azure/msal-node');
const legacy = require('./auth');

const SCOPES = ['openid', 'profile', 'email', 'User.Read'];
const COOKIE = 't4e_growth_ms';
const env = (k) => String(process.env[k] || '').trim();
const TENANT = () => env('AZURE_TENANT_ID');
const DOMAIN = () => (env('ALLOWED_EMAIL_DOMAIN') || 'think4ever.com').toLowerCase().replace(/^@/, '');
const LEGACY = () => env('LEGACY_LOGIN').toLowerCase() === 'true';
const HOURS = Number(env('SESSION_HOURS')) > 0 ? Number(env('SESSION_HOURS')) : 10;
// Public home path of the app: everything before /auth/ in AUTH_REDIRECT_URI
// (e.g. /project-8804a3dabc/286), falling back to BASE_PATH (/run/286) when it can't be read.
function publicPrefix() {
  try {
    const p = new URL(env('AUTH_REDIRECT_URI')).pathname;
    const i = p.indexOf('/auth/');
    if (i >= 0) return p.slice(0, i).replace(/\/+$/, '');
  } catch (e) { /* fall back below */ }
  return env('BASE_PATH').replace(/\/+$/, '');
}
const PREFIX = publicPrefix();
const COOKIE_PATH = `${PREFIX}/`; // public home, e.g. "/project-8804a3dabc/286/"
const msConfigured = () => ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AUTH_REDIRECT_URI'].every((k) => env(k));
const hasDb = !!(process.env.DATABASE_URL || process.env.DB_HOST || process.env.MYSQL_HOST);

// Pages and endpoints that never need a session.
const OPEN = new Set(['/login.html', '/app.css', '/api/auth-config', '/health', '/api/health', '/favicon.ico']);

function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Same connection variables as lib/store (DATABASE_URL or DB_* / MYSQL_*); lib/store itself is untouched.
function dbOptions() {
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    return {
      host: u.hostname, port: Number(u.port || 3306),
      user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    };
  }
  return {
    host: process.env.DB_HOST || process.env.MYSQL_HOST,
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.DB_USER || process.env.MYSQL_USER,
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD,
    database: process.env.DB_NAME || process.env.DB_DATABASE || process.env.MYSQL_DATABASE,
  };
}
let _pool;
function pool() {
  if (!hasDb) throw new Error('database required for Microsoft sign-in');
  if (!_pool) _pool = require('mysql2/promise').createPool({ ...dbOptions(), waitForConnections: true, connectionLimit: 3, charset: 'utf8mb4' });
  return _pool;
}

let _cca;
function client() {
  if (!_cca) {
    _cca = new msal.ConfidentialClientApplication({
      auth: { clientId: env('AZURE_CLIENT_ID'), authority: `https://login.microsoftonline.com/${TENANT()}`, clientSecret: env('AZURE_CLIENT_SECRET') },
      system: { loggerOptions: { loggerCallback() {}, piiLoggingEnabled: false } },
    });
  }
  return _cca;
}

function sessionMiddleware() {
  let secret = env('SESSION_SECRET');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    console.warn('SESSION_SECRET is not set: using a random secret, so sessions end on every restart.');
  }
  let store;
  if (hasDb) {
    const MySQLStore = require('express-mysql-session')(session);
    store = new MySQLStore({
      ...dbOptions(),
      createDatabaseTable: true, // the table is already provisioned; this is a no-op safety net
      clearExpired: true,
      checkExpirationInterval: 15 * 60e3,
      expiration: HOURS * 3600e3,
      schema: { tableName: 'sessions', columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' } },
    });
  } else {
    console.warn('No database configured: sessions are kept in memory (local tests only).');
  }
  const inner = session({
    name: COOKIE,
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    proxy: true, // the public URL is HTTPS at the proxy; read X-Forwarded-Proto for the secure cookie
    cookie: { httpOnly: true, secure: true, sameSite: 'lax', path: COOKIE_PATH, maxAge: HOURS * 3600e3 },
  });
  // The proxy strips /run/<id> before forwarding, but express-session compares the cookie path
  // (/run/<id>/) with req.originalUrl and silently skips the session when they differ. That check
  // happens synchronously when the middleware starts, so the public path is shown only for that call.
  const prefix = PREFIX;
  return function sessionWithPublicPath(req, res, next) {
    const orig = req.originalUrl;
    if (!prefix || orig === prefix || orig.startsWith(`${prefix}/`)) return inner(req, res, next);
    req.originalUrl = prefix + orig;
    try {
      inner(req, res, next);
    } finally {
      if (req.originalUrl === prefix + orig) req.originalUrl = orig;
    }
  };
}

const REASONS = {
  tenant: 'Esta cuenta pertenece a otra organización. Solo se aceptan cuentas de think4ever.',
  domain: `Solo se aceptan cuentas @${DOMAIN()}. Inicia sesión con tu cuenta de think4ever.`,
  guest: 'Las cuentas invitadas (de otros dominios) no tienen acceso. Usa tu cuenta de think4ever.',
  disabled: 'Tu usuario está desactivado. Pide acceso al equipo de Research.',
  conflict: 'Ya existe un usuario con este correo vinculado a otra cuenta. Pide ayuda al equipo de Research.',
  not_configured: 'El inicio de sesión con Microsoft todavía no está configurado. Avisa al equipo de Research.',
  cancelled: 'Se canceló el inicio de sesión con Microsoft.',
  state: 'La solicitud de inicio de sesión expiró o no es válida. Inténtalo de nuevo.',
  token: 'No pudimos validar tu cuenta con Microsoft. Inténtalo de nuevo.',
  session: 'No pudimos iniciar tu sesión. Inténtalo de nuevo.',
};
// One heading per reason: only wrong-account cases say "Solo cuentas de think4ever".
const HEADINGS = {
  tenant: 'Solo cuentas de think4ever',
  domain: 'Solo cuentas de think4ever',
  guest: 'Solo cuentas de think4ever',
  disabled: 'Acceso desactivado',
  conflict: 'Cuenta en conflicto',
  not_configured: 'Inicio de sesión no disponible',
  cancelled: 'Inicio de sesión cancelado',
  state: 'La solicitud expiró',
  token: 'No se pudo completar el inicio de sesión',
  session: 'No se pudo completar el inicio de sesión',
};
// Served from auth/*. No fixed <base>: the app's home is worked out in the browser from the current
// address (everything up to /auth/), so it works on /run/<id>/ and on the public /project-.../ link alike.
// Without JavaScript, relative ../ links (depth of the current auth/* path) are the fallback.
function deny(res, reason) {
  console.warn('msauth denied:', reason);
  const msg = REASONS[reason] || REASONS.token;
  const heading = HEADINGS[reason] || HEADINGS.token;
  const rel = res.req ? toRoot(res.req) : '../';
  const home = `(function(){var p=location.pathname,i=p.indexOf('/auth/');return i>=0?p.slice(0,i+1):${JSON.stringify(rel)};})()`;
  res.status(403).type('html').send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading} · LATAM Growth</title>
<script>document.write('<link rel="stylesheet" href="'+${home}+'app.css">');</script>
<noscript><link rel="stylesheet" href="${rel}app.css"></noscript>
<style>.wrap{min-height:100vh;display:grid;place-items:center;padding-inline:16px}.box{width:100%;max-width:400px;display:grid;gap:14px}.box h1{margin:0;font-size:20px}.box p{margin:0;color:var(--text-2)}</style>
</head><body><div class="wrap"><div class="card box">
<div class="brand"><span class="t4e-word">think<b>4</b>ever</span> <span class="brand-title">LATAM Growth</span></div>
<h1>${heading}</h1>
<p>${msg}</p>
<a class="btn" id="back-login" href="${rel}login.html">Volver a iniciar sesión</a>
</div></div>
<script>document.getElementById('back-login').setAttribute('href',${home}+'login.html');</script>
</body></html>`);
}

// Redirects are always RELATIVE: the proxy strips /run/<id>, so an absolute path would escape the app.
// Relative path from the current request back to the app root ("" at depth 0, "../" under auth/, ...).
function toRoot(req) {
  const depth = Math.max(0, req.path.split('/').length - 2);
  return '../'.repeat(depth);
}

function logoutUrl(req) {
  if (!msConfigured()) return `${toRoot(req)}login.html`; // auth/logout -> ../login.html
  let origin = '';
  try { origin = new URL(env('AUTH_REDIRECT_URI')).origin; } catch (e) { origin = `${req.protocol}://${req.get('host')}`; }
  const back = `${origin}${PREFIX}/login.html`;
  return `https://login.microsoftonline.com/${encodeURIComponent(TENANT())}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(back)}`;
}

// Back to login.html from any depth (executive/... included), always relative.
function toLogin(req) {
  return `${toRoot(req)}login.html`;
}

function requireAuth(req, res, next) {
  if (OPEN.has(req.path) || req.path.startsWith('/auth/')) return next();
  const u = req.session && req.session.user;
  if (u) { req.user = u.email; req.role = 'admin'; req.account = u; return next(); } // one access level (#113/#123)
  if (LEGACY()) {
    const s = legacy.check(req);
    if (s) {
      req.user = s.u; req.role = s.role;
      const blocked = legacy.writeGate(req);
      if (blocked) return res.status(403).json({ error: blocked });
      return next();
    }
  }
  // Machine loads (daily routine): unchanged rule, POST api/ingest with a matching x-ingest-key.
  if (legacy.ingestKeyOk(req)) { req.user = 'ingest-key'; req.role = 'ingest'; return next(); }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'auth' });
  res.redirect(toLogin(req));
}

function mount(app) {
  app.use(sessionMiddleware());

  app.get('/api/auth-config', (req, res) => res.json({ microsoft: msConfigured(), legacy: LEGACY() }));

  app.get('/auth/login', async (req, res) => {
    if (!msConfigured()) return deny(res, 'not_configured');
    try {
      const { verifier, challenge } = await new msal.CryptoProvider().generatePkceCodes();
      const state = crypto.randomBytes(24).toString('base64url');
      req.session.msAuth = { state, verifier, at: Date.now() };
      const url = await client().getAuthCodeUrl({
        scopes: SCOPES, redirectUri: env('AUTH_REDIRECT_URI'), state,
        codeChallenge: challenge, codeChallengeMethod: 'S256', prompt: 'select_account',
      });
      req.session.save((err) => (err ? deny(res, 'session') : res.redirect(url)));
    } catch (e) {
      console.error('msauth login', e.errorCode || e.message);
      deny(res, 'token');
    }
  });

  // Both addresses run the same sign-in logic; .env / Entra use auth/microsoft/callback.
  app.get(['/auth/callback', '/auth/microsoft/callback'], async (req, res) => {
    if (!msConfigured()) return deny(res, 'not_configured');
    const pending = req.session && req.session.msAuth;
    if (req.session) delete req.session.msAuth;
    if (req.query.error) return deny(res, req.query.error === 'access_denied' ? 'cancelled' : 'token');
    if (!pending || !req.query.state || !req.query.code || Date.now() - pending.at > 15 * 60e3 || !sameText(req.query.state, pending.state)) return deny(res, 'state');

    let result;
    try {
      result = await client().acquireTokenByCode({
        code: String(req.query.code), scopes: SCOPES, redirectUri: env('AUTH_REDIRECT_URI'), codeVerifier: pending.verifier,
      });
    } catch (e) {
      console.warn('msauth token', e.errorCode || e.message);
      return deny(res, 'token');
    }
    const c = (result && result.idTokenClaims) || {};
    const tid = String(c.tid || '').toLowerCase();
    if (!tid || !sameText(tid, TENANT().toLowerCase())) return deny(res, 'tenant');
    // Guests (B2B) carry an idp claim pointing at their home issuer instead of think4ever's tenant.
    if (c.idp && String(c.idp).toLowerCase().replace(/\/+$/, '') !== `https://sts.windows.net/${tid}`) return deny(res, 'guest');
    const email = String(c.email || c.preferred_username || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || !email.endsWith(`@${DOMAIN()}`)) return deny(res, 'domain');
    if (!c.oid) return deny(res, 'token');
    const name = String(c.name || email).slice(0, 255);

    let user;
    try {
      const db = pool();
      await db.query(
        `INSERT INTO users (entra_oid, email, display_name, last_login_at) VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           email = IF(entra_oid = VALUES(entra_oid), VALUES(email), email),
           display_name = IF(entra_oid = VALUES(entra_oid), VALUES(display_name), display_name),
           last_login_at = IF(entra_oid = VALUES(entra_oid), NOW(), last_login_at)`,
        [String(c.oid), email, name]
      );
      const [rows] = await db.query('SELECT id, email, display_name, status FROM users WHERE entra_oid = ?', [String(c.oid)]);
      user = rows[0];
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return deny(res, 'conflict');
      console.error('msauth user upsert', e.message);
      return deny(res, 'session');
    }
    if (!user) return deny(res, 'conflict');
    if (user.status === 'disabled') return deny(res, 'disabled');

    req.session.regenerate((err) => {
      if (err) return deny(res, 'session');
      req.session.user = { id: user.id, email: user.email, name: user.display_name || user.email };
      // Always land on the Overview dashboard after a successful sign-in (relative: auth/callback -> ../#overview).
      req.session.save((e) => (e ? deny(res, 'session') : res.redirect(`${toRoot(req) || './'}#overview`)));
    });
  });

  app.get('/auth/logout', (req, res) => {
    const done = () => {
      res.clearCookie(COOKIE, { path: COOKIE_PATH, httpOnly: true, secure: true, sameSite: 'lax' });
      res.append('Set-Cookie', legacy.clearCookieHeader(req));
      res.redirect(logoutUrl(req));
    };
    if (req.session) req.session.destroy(() => done()); else done();
  });

  // Old predetermined-user login: answers only when LEGACY_LOGIN=true.
  legacy.mountRoutes(app, LEGACY);

  app.get('/api/me', (req, res) => {
    const u = req.session && req.session.user;
    if (u) return res.json({ email: u.email, name: u.name });
    if (LEGACY()) {
      const s = legacy.check(req);
      if (s) return res.json({ name: s.u, user: s.u, role: s.role });
    }
    res.status(401).json({ error: 'auth' });
  });

  app.use(requireAuth);
}

function describe() {
  const parts = [];
  if (!msConfigured()) parts.push('Microsoft sign-in not configured: set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AUTH_REDIRECT_URI');
  if (LEGACY()) parts.push(`legacy login on${legacy.configured() ? '' : ' (DASH_USERS not set)'}`);
  return parts.length ? ` (${parts.join('; ')})` : '';
}

module.exports = { mount, requireAuth, describe, msConfigured };
