/**
 * WattWise – Smart Energy Monitoring Backend
 * ─────────────────────────────────────────────
 * Stack: Node.js + Express + better-sqlite3 + JWT + bcrypt
 *
 * Install:  npm install
 * Run:      node server.js
 * Dev:      node --watch server.js
 *
 * API runs on http://localhost:3000
 * Frontend is served from /public/index.html
 */

const express      = require('express');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const Database     = require('better-sqlite3');

/* ─── CONFIG ───────────────────────────────── */
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'wattwise-secret-change-in-production-2024';
const DB_FILE    = path.join(__dirname, 'db', 'wattwise.db');

/* ─── DB INIT ──────────────────────────────── */
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    meter_id    TEXT UNIQUE NOT NULL,
    address     TEXT DEFAULT '',
    category    TEXT DEFAULT 'Domestic LT - HT-2B',
    tariff      REAL DEFAULT 9.0,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS meter_readings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
    kwh         REAL NOT NULL,
    kw          REAL NOT NULL,
    voltage     REAL DEFAULT 229,
    current_a   REAL,
    power_factor REAL DEFAULT 0.92
  );

  CREATE TABLE IF NOT EXISTS monthly_bills (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    month       TEXT NOT NULL,
    units_kwh   REAL NOT NULL,
    amount      REAL NOT NULL,
    fixed_charge REAL DEFAULT 160,
    paid        INTEGER DEFAULT 0,
    due_date    TEXT
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    read        INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  );
`);

/* ─── SEED DEMO DATA ───────────────────────── */
function seedDemoUser() {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('demo@wattwise.app');
  if (existing) return;

  const hash = bcrypt.hashSync('Demo@1234', 10);
  const userId = db.prepare(`
    INSERT INTO users (name, email, password, meter_id, address, category)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('Arjun Kumar', 'demo@wattwise.app', hash, 'TNEB-2024-00187',
         '42, Anna Nagar, Chennai – 600040', 'Domestic LT - HT-2B').lastInsertRowid;

  // Seed 30 days × 24 hourly readings
  const baseHourly = [0.3,0.2,0.1,0.1,0.2,0.6,1.4,2.3,3.1,3.5,4.0,4.3,4.1,3.7,4.4,5.3,5.0,4.6,4.0,3.4,2.9,2.4,1.8,1.3];
  const insertReading = db.prepare(`
    INSERT INTO meter_readings (user_id, recorded_at, kwh, kw, voltage, current_a)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const seedReadings = db.transaction(() => {
    for (let day = 29; day >= 0; day--) {
      for (let h = 0; h < 24; h++) {
        const base = baseHourly[h];
        const noise = (Math.random() - 0.45) * 0.6;
        const kw = Math.max(0.05, base + noise);
        const kwh = kw; // 1 reading per hour = kWh ≈ kW
        const d = new Date();
        d.setDate(d.getDate() - day);
        d.setHours(h, 0, 0, 0);
        insertReading.run(userId, d.toISOString(), +kwh.toFixed(3), +kw.toFixed(3), 229, +(kw*1000/229).toFixed(2));
      }
    }
  });
  seedReadings();

  // Monthly bills (last 6 months)
  const months = ['2025-10','2025-11','2025-12','2026-01','2026-02','2026-03'];
  const units   = [610,580,720,650,490,542];
  const insertBill = db.prepare(`
    INSERT INTO monthly_bills (user_id, month, units_kwh, amount, paid, due_date)
    VALUES (?,?,?,?,?,?)
  `);
  months.forEach((m, i) => {
    const amt = units[i] * 9 + 160;
    insertBill.run(userId, m, units[i], amt, i < 5 ? 1 : 0, `${m}-15`);
  });

  // Seed alerts
  const alerts = [
    ['warning', 'High usage — 3:00–5:00 PM', 'Yesterday\'s spike was 38% above average. AC ran 4 hours straight.'],
    ['tip',     'Save ₹400/month',            'Set AC to 24°C instead of 18°C. Saves ~6 kWh/day.'],
    ['bill',    'March bill estimate ready',   'Projected ₹4,878 — ₹612 lower than February!'],
    ['success', 'Meter sync successful',       'TNEB-2024-00187 reconnected and streaming live data.'],
    ['trophy',  'Achievement: Eco Champion!',  'You\'ve reduced usage 10%+ for 3 consecutive months!'],
  ];
  const insertAlert = db.prepare(`
    INSERT INTO alerts (user_id, type, title, body) VALUES (?,?,?,?)
  `);
  alerts.forEach(([type, title, body]) => insertAlert.run(userId, type, title, body));

  console.log('✅ Demo user seeded — email: demo@wattwise.app  password: Demo@1234');
}
seedDemoUser();

/* ─── HELPERS ──────────────────────────────── */
const signToken = (userId) =>
  jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function generateLiveReading(userId) {
  // Simulate a realistic live reading based on time of day
  const hour = new Date().getHours();
  const base = [0.3,0.2,0.1,0.1,0.2,0.6,1.4,2.3,3.1,3.5,4.0,4.3,4.1,3.7,4.4,5.3,5.0,4.6,4.0,3.4,2.9,2.4,1.8,1.3][hour];
  const kw   = +(base + (Math.random() - 0.4) * 0.6).toFixed(2);
  const kwh  = kw;
  const v    = 229;
  const a    = +(kw * 1000 / v).toFixed(2);
  return { kw, kwh, voltage: v, current_a: a, power_factor: 0.92, frequency: 50, timestamp: new Date().toISOString() };
}

/* ─── EXPRESS APP ──────────────────────────── */
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// Rate limiters
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many attempts, try again later' } });
const apiLimiter   = rateLimit({ windowMs: 60 * 1000, max: 120 });
app.use('/api/', apiLimiter);

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

/* ══════════════════════════════════════════════
   AUTH ROUTES
══════════════════════════════════════════════ */

// POST /api/auth/register
app.post('/api/auth/register', loginLimiter, async (req, res) => {
  try {
    const { name, email, password, meter_id, address } = req.body;
    if (!name || !email || !password || !meter_id)
      return res.status(400).json({ error: 'name, email, password and meter_id are required' });

    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = db.prepare('SELECT id FROM users WHERE email=? OR meter_id=?').get(email, meter_id);
    if (existing)
      return res.status(409).json({ error: 'Email or meter ID already registered' });

    const hash   = await bcrypt.hash(password, 10);
    const result = db.prepare(`
      INSERT INTO users (name, email, password, meter_id, address)
      VALUES (?,?,?,?,?)
    `).run(name, email, hash, meter_id, address || '');

    const token = signToken(result.lastInsertRowid);
    const user  = db.prepare('SELECT id,name,email,meter_id,address,category,tariff,created_at FROM users WHERE id=?').get(result.lastInsertRowid);
    res.status(201).json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password, meter_id } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'email and password are required' });

    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!user)
      return res.status(401).json({ error: 'Invalid email or password' });

    // If meter_id provided, validate it matches
    if (meter_id && user.meter_id !== meter_id)
      return res.status(401).json({ error: 'Meter ID does not match this account' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok)
      return res.status(401).json({ error: 'Invalid email or password' });

    const token   = signToken(user.id);
    const { password: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT id,name,email,meter_id,address,category,tariff,created_at FROM users WHERE id=?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

/* ══════════════════════════════════════════════
   ENERGY ROUTES
══════════════════════════════════════════════ */

// GET /api/energy/live  — simulated real-time reading
app.get('/api/energy/live', auth, (req, res) => {
  const reading = generateLiveReading(req.user.userId);

  // Persist the live reading
  db.prepare(`
    INSERT INTO meter_readings (user_id, recorded_at, kwh, kw, voltage, current_a, power_factor)
    VALUES (?,?,?,?,?,?,?)
  `).run(req.user.userId, reading.timestamp, reading.kwh, reading.kw,
         reading.voltage, reading.current_a, reading.power_factor);

  res.json(reading);
});

// GET /api/energy/today  — hourly breakdown for today
app.get('/api/energy/today', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT strftime('%H', recorded_at) as hour,
           ROUND(SUM(kwh), 3) as total_kwh,
           ROUND(AVG(kw), 3)  as avg_kw
    FROM meter_readings
    WHERE user_id = ?
      AND DATE(recorded_at) = DATE('now')
    GROUP BY hour
    ORDER BY hour
  `).all(req.user.userId);

  const total = rows.reduce((s, r) => s + r.total_kwh, 0);
  const user  = db.prepare('SELECT tariff FROM users WHERE id=?').get(req.user.userId);
  res.json({ hours: rows, total_kwh: +total.toFixed(3), cost: +(total * (user?.tariff || 9)).toFixed(2) });
});

// GET /api/energy/weekly  — daily totals for last 7 days
app.get('/api/energy/weekly', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT DATE(recorded_at) as date,
           ROUND(SUM(kwh), 2) as total_kwh,
           ROUND(AVG(kw), 3)  as avg_kw
    FROM meter_readings
    WHERE user_id = ?
      AND recorded_at >= DATE('now', '-6 days')
    GROUP BY date
    ORDER BY date
  `).all(req.user.userId);
  res.json({ days: rows });
});

// GET /api/energy/monthly?months=6  — monthly totals
app.get('/api/energy/monthly', auth, (req, res) => {
  const n = Math.min(parseInt(req.query.months) || 6, 24);
  const rows = db.prepare(`
    SELECT strftime('%Y-%m', recorded_at) as month,
           ROUND(SUM(kwh), 2)  as total_kwh
    FROM meter_readings
    WHERE user_id = ?
    GROUP BY month
    ORDER BY month DESC
    LIMIT ?
  `).all(req.user.userId, n).reverse();
  res.json({ months: rows });
});

// GET /api/energy/heatmap  — 7 days × 24 hours matrix
app.get('/api/energy/heatmap', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT DATE(recorded_at)          as date,
           CAST(strftime('%H', recorded_at) AS INTEGER) as hour,
           ROUND(SUM(kwh), 3)         as kwh
    FROM meter_readings
    WHERE user_id = ?
      AND recorded_at >= DATE('now', '-6 days')
    GROUP BY date, hour
    ORDER BY date, hour
  `).all(req.user.userId);
  res.json({ data: rows });
});

// GET /api/energy/stats  — summary stats for dashboard
app.get('/api/energy/stats', auth, (req, res) => {
  const user = db.prepare('SELECT tariff FROM users WHERE id=?').get(req.user.userId);
  const tariff = user?.tariff || 9;

  const today = db.prepare(`
    SELECT ROUND(SUM(kwh),3) as kwh FROM meter_readings
    WHERE user_id=? AND DATE(recorded_at)=DATE('now')
  `).get(req.user.userId);

  const yesterday = db.prepare(`
    SELECT ROUND(SUM(kwh),3) as kwh FROM meter_readings
    WHERE user_id=? AND DATE(recorded_at)=DATE('now','-1 day')
  `).get(req.user.userId);

  const thisMonth = db.prepare(`
    SELECT ROUND(SUM(kwh),3) as kwh FROM meter_readings
    WHERE user_id=? AND strftime('%Y-%m', recorded_at)=strftime('%Y-%m','now')
  `).get(req.user.userId);

  const lastMonth = db.prepare(`
    SELECT ROUND(SUM(kwh),3) as kwh FROM meter_readings
    WHERE user_id=? AND strftime('%Y-%m', recorded_at)=strftime('%Y-%m','now','-1 month')
  `).get(req.user.userId);

  const todayKwh    = today?.kwh || 0;
  const yesterdayKwh = yesterday?.kwh || 0;
  const monthKwh    = thisMonth?.kwh || 0;
  const lastMonthKwh = lastMonth?.kwh || 0;

  // Eco score: simple formula — lower vs last month = higher score
  const savingsPct = lastMonthKwh > 0 ? ((lastMonthKwh - monthKwh) / lastMonthKwh) * 100 : 0;
  const ecoScore   = Math.min(100, Math.max(0, Math.round(65 + savingsPct * 1.5)));

  res.json({
    today_kwh:       todayKwh,
    today_cost:      +(todayKwh * tariff).toFixed(2),
    yesterday_kwh:   yesterdayKwh,
    change_pct:      yesterdayKwh > 0 ? +((todayKwh - yesterdayKwh) / yesterdayKwh * 100).toFixed(1) : 0,
    month_kwh:       monthKwh,
    month_cost:      +(monthKwh * tariff + 160).toFixed(2),
    last_month_kwh:  lastMonthKwh,
    month_change_pct:lastMonthKwh > 0 ? +((monthKwh - lastMonthKwh) / lastMonthKwh * 100).toFixed(1) : 0,
    eco_score:       ecoScore,
    tariff
  });
});

/* ══════════════════════════════════════════════
   BILLS ROUTES
══════════════════════════════════════════════ */

// GET /api/bills
app.get('/api/bills', auth, (req, res) => {
  const bills = db.prepare(`
    SELECT * FROM monthly_bills WHERE user_id=? ORDER BY month DESC LIMIT 12
  `).all(req.user.userId);
  res.json({ bills });
});

/* ══════════════════════════════════════════════
   ALERTS ROUTES
══════════════════════════════════════════════ */

// GET /api/alerts
app.get('/api/alerts', auth, (req, res) => {
  const alerts = db.prepare(`
    SELECT * FROM alerts WHERE user_id=? ORDER BY created_at DESC LIMIT 20
  `).all(req.user.userId);
  res.json({ alerts, unread: alerts.filter(a => !a.read).length });
});

// PATCH /api/alerts/:id/read
app.patch('/api/alerts/:id/read', auth, (req, res) => {
  db.prepare('UPDATE alerts SET read=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.userId);
  res.json({ ok: true });
});

// PATCH /api/alerts/read-all
app.patch('/api/alerts/read-all', auth, (req, res) => {
  db.prepare('UPDATE alerts SET read=1 WHERE user_id=?').run(req.user.userId);
  res.json({ ok: true });
});

/* ══════════════════════════════════════════════
   PROFILE ROUTES
══════════════════════════════════════════════ */

// PATCH /api/profile
app.patch('/api/profile', auth, async (req, res) => {
  const { name, address, category } = req.body;
  db.prepare('UPDATE users SET name=COALESCE(?,name), address=COALESCE(?,address), category=COALESCE(?,category) WHERE id=?')
    .run(name || null, address || null, category || null, req.user.userId);
  const user = db.prepare('SELECT id,name,email,meter_id,address,category,tariff,created_at FROM users WHERE id=?').get(req.user.userId);
  res.json({ user });
});

// PATCH /api/profile/password
app.patch('/api/profile/password', auth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password || new_password.length < 6)
    return res.status(400).json({ error: 'Passwords required, min 6 chars' });

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.userId);
  const ok   = await bcrypt.compare(current_password, user.password);
  if (!ok) return res.status(401).json({ error: 'Current password is wrong' });

  const hash = await bcrypt.hash(new_password, 10);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, req.user.userId);
  res.json({ ok: true });
});

/* ─── FALLBACK → SPA ───────────────────────── */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ─── START ────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\n⚡ WattWise server running → http://localhost:${PORT}`);
  console.log(`   Demo login: demo@wattwise.app  /  Demo@1234  /  TNEB-2024-00187\n`);
});

module.exports = app;
