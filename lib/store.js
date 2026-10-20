'use strict';
// Generic key-value store: one table gd_items (kind, k, data JSON) with a unique (kind, k).
// Kinds: metric, snapshot, event, source, note, synclog.
// In the Think4Ever runtime it uses MySQL (DATABASE_URL or DB_*). Without a database (local tests)
// it falls back to data/local.json.
const fs = require('fs');
const path = require('path');

const hasDb = !!(process.env.DATABASE_URL || process.env.DB_HOST || process.env.MYSQL_HOST);

function mysqlStore() {
  const mysql = require('mysql2/promise');
  const common = { waitForConnections: true, connectionLimit: 5, charset: 'utf8mb4', dateStrings: true };
  const pool = process.env.DATABASE_URL
    ? mysql.createPool({ uri: process.env.DATABASE_URL, ...common })
    : mysql.createPool({
        host: process.env.DB_HOST || process.env.MYSQL_HOST,
        port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
        user: process.env.DB_USER || process.env.MYSQL_USER,
        password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD,
        database: process.env.DB_NAME || process.env.DB_DATABASE || process.env.MYSQL_DATABASE,
        ...common,
      });
  const parse = (r) => ({ ...(typeof r.data === 'string' ? JSON.parse(r.data) : r.data), _k: r.k, _at: r.updated_at });
  return {
    kind: 'mysql',
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS gd_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        kind VARCHAR(20) NOT NULL,
        k VARCHAR(255) NOT NULL,
        data JSON NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_kind_k (kind, k),
        INDEX idx_kind (kind)
      ) CHARACTER SET utf8mb4`);
    },
    async list(kind) {
      const [rows] = await pool.query('SELECT k, data, updated_at FROM gd_items WHERE kind = ? ORDER BY id', [kind]);
      return rows.map(parse);
    },
    async upsert(kind, k, data) {
      await pool.query(
        'INSERT INTO gd_items (kind, k, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
        [kind, k, JSON.stringify(data)]
      );
    },
    async remove(kind, k) {
      const [r] = await pool.query('DELETE FROM gd_items WHERE kind = ? AND k = ?', [kind, k]);
      return r.affectedRows > 0;
    },
    async removePrefix(kind, prefix) {
      await pool.query('DELETE FROM gd_items WHERE kind = ? AND k LIKE ?', [kind, prefix.replace(/[%_]/g, '\\$&') + '%']);
    },
    async count(kind) {
      const [rows] = await pool.query('SELECT COUNT(*) AS n FROM gd_items WHERE kind = ?', [kind]);
      return rows[0].n;
    },
    async ping() { await pool.query('SELECT 1'); },
  };
}

function jsonStore() {
  const file = path.join(__dirname, '..', 'data', 'local.json');
  let db = { items: [] };
  const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(db)); };
  const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  return {
    kind: 'json',
    async init() { if (fs.existsSync(file)) db = JSON.parse(fs.readFileSync(file, 'utf8')); },
    async list(kind) { return db.items.filter((i) => i.kind === kind).map((i) => ({ ...i.data, _k: i.k, _at: i.at })); },
    async upsert(kind, k, data) {
      const it = db.items.find((i) => i.kind === kind && i.k === k);
      if (it) { it.data = data; it.at = now(); } else db.items.push({ kind, k, data, at: now() });
      save();
    },
    async remove(kind, k) {
      const n = db.items.length;
      db.items = db.items.filter((i) => !(i.kind === kind && i.k === k));
      save();
      return db.items.length < n;
    },
    async removePrefix(kind, prefix) { db.items = db.items.filter((i) => !(i.kind === kind && i.k.startsWith(prefix))); save(); },
    async count(kind) { return db.items.filter((i) => i.kind === kind).length; },
    async ping() {},
  };
}

module.exports = hasDb ? mysqlStore() : jsonStore();
