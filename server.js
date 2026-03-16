// Elevate Volunteer Hub — Railway server
// Environment variables to set in Railway:
//   APP_PASSWORD   — password to access the app
//   SESSION_SECRET — any long random string for signing session cookies
//   DATABASE_URL   — set automatically by Railway when you add a Postgres plugin

const express = require('express');
const session = require('express-session');
const path    = require('path');
const { Pool } = require('pg');

const APP_PASSWORD   = process.env.APP_PASSWORD || 'elevate2025';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
const PORT           = process.env.PORT || 3000;

// ── Database ─────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Default dropdown options
const DEFAULTS = {
  roles: ['Ta/Teacher', 'WFS Tutor', 'Medical Mentor', 'E-Pal', 'Advocate', 'Prayer Partner'],
  stages: ['Contact in Review', '#1. Intake Form Sent', '#2 Intake Form Received', '#3. Program Form Completed', '#4 Application Pieces', '#5 Onboarding', '#5 Advocating', '#1 Teaching', '#2 Inactive', '#3 Non-Return'],
  owners: ['Lauren', 'Micaela'],
  timezones: ['GMT-8 (Pacific)', 'GMT-7 (Mountain)', 'GMT-6 (Central)', 'GMT-5 (Eastern)', 'GMT-4 (Atlantic)', 'GMT+0 (UTC)', 'GMT+1 (W. Europe)', 'GMT+2 (E. Europe)', 'GMT+5:30 (India)', 'GMT+8 (China/HK)', 'GMT+9 (Japan)', 'GMT+10 (Australia E)', 'GMT+12 (NZ)']
};

// Create tables if they don't exist yet — runs once on startup
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS volunteers (
      id        SERIAL PRIMARY KEY,
      data      JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value JSONB NOT NULL
    )
  `);
  // Seed defaults if not already set
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(value)]
    );
  }
  console.log('Database ready.');
}
initDB().catch(err => console.error('DB init error:', err.message));

// ── Express setup ─────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT,
    sameSite: 'lax'
  }
}));

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/login');
}

// ── Login page ────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ELIC Online — Volunteer Hub</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #2c3e50; font-family: 'DM Sans', sans-serif; min-height: 100vh;
    display: flex; align-items: center; justify-content: center; }
  .box { background: white; border-radius: 12px; padding: 48px 40px; width: 100%;
    max-width: 360px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); text-align: center; }
  h1 { font-family: 'DM Serif Display', serif; font-size: 2rem; color: #2c3e50; margin-bottom: 4px; }
  h1 span { color: #2d9d8f; }
  p { color: #718096; font-size: 14px; margin-bottom: 32px; }
  input { width: 100%; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 8px;
    font-size: 14px; margin-bottom: 12px; outline: none; font-family: 'DM Sans', sans-serif; }
  input:focus { border-color: #2d9d8f; box-shadow: 0 0 0 3px rgba(45,157,143,0.1); }
  button { width: 100%; padding: 12px; background: #2d9d8f; color: white; border: none;
    border-radius: 8px; cursor: pointer; font-family: 'DM Sans', sans-serif;
    font-size: 14px; font-weight: 600; }
  button:hover { background: #1a7a6e; }
  .error { color: #d95f4b; font-size: 13px; margin-bottom: 12px; }
</style>
</head>
<body>
<div class="box">
  <h1>ELIC <span>Online</span></h1>
  <p>Volunteer Hub</p>
  ${req.query.error ? '<div class="error">Incorrect password — try again.</div>' : ''}
  <form method="POST" action="/login">
    <input type="password" name="password" placeholder="Password" autofocus />
    <button type="submit">Sign in →</button>
  </form>
</div>
</body>
</html>`);
});

app.post('/login', (req, res) => {
  if (req.body.password === APP_PASSWORD) {
    req.session.authenticated = true;
    res.redirect('/');
  } else {
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ── Volunteers API ────────────────────────────────────────────────────────────

// GET all volunteers
app.get('/api/volunteers', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, data, created_at FROM volunteers ORDER BY created_at ASC'
    );
    // Return each row with id merged into data for the frontend
    const volunteers = result.rows.map(row => ({ id: row.id, ...row.data }));
    res.json(volunteers);
  } catch (err) {
    console.error('GET /api/volunteers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST add a volunteer
app.post('/api/volunteers', requireAuth, async (req, res) => {
  try {
    const { id: _ignore, ...data } = req.body; // strip any client-side id
    const result = await pool.query(
      'INSERT INTO volunteers (data) VALUES ($1) RETURNING id, data, created_at',
      [JSON.stringify(data)]
    );
    const row = result.rows[0];
    res.json({ id: row.id, ...row.data });
  } catch (err) {
    console.error('POST /api/volunteers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT update a volunteer
app.put('/api/volunteers/:id', requireAuth, async (req, res) => {
  try {
    const { id: _ignore, ...data } = req.body;
    const result = await pool.query(
      `UPDATE volunteers SET data = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id, data`,
      [JSON.stringify(data), req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = result.rows[0];
    res.json({ id: row.id, ...row.data });
  } catch (err) {
    console.error('PUT /api/volunteers/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE a volunteer
app.delete('/api/volunteers/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM volunteers WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/volunteers/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Settings API ──────────────────────────────────────────────────────────────

// GET all settings
app.get('/api/settings', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM settings');
    const settings = {};
    result.rows.forEach(row => { settings[row.key] = row.value; });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update a setting (replaces the full array for that key)
app.put('/api/settings/:key', requireAuth, async (req, res) => {
  const { key } = req.params;
  if (!['roles', 'stages', 'owners', 'timezones'].includes(key)) {
    return res.status(400).json({ error: 'Invalid setting key' });
  }
  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [key, JSON.stringify(req.body.value)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Static files ──────────────────────────────────────────────────────────────
app.use(requireAuth, express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Elevate Volunteer Hub running on port ${PORT}`));
