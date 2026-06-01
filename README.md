# ⚡ WattWise – Smart Energy Monitoring App

A full-stack smart energy monitoring web app with real-time readings,
user authentication, per-meter data, analytics, and alerts.

---

## 🚀 Quick Start (3 steps)

### 1. Install dependencies
```bash
cd wattwise
npm install
```

### 2. Start the server
```bash
node server.js
```

### 3. Open in browser
```
http://localhost:3000
```

---

## 🔑 Demo Login (pre-seeded)
| Field        | Value                  |
|--------------|------------------------|
| Email        | demo@wattwise.app      |
| Password     | Demo@1234              |
| Meter Number | TNEB-2024-00187        |

Anyone can also **Register** with their own email + meter number.

---

## 📁 Project Structure
```
wattwise/
├── server.js          ← Express backend + all API routes
├── package.json       ← Dependencies
├── db/
│   └── wattwise.db    ← SQLite database (auto-created on first run)
└── public/
    └── index.html     ← Full frontend (served by Express)
```

---

## 🔌 API Endpoints

### Auth
| Method | Route                    | Description              |
|--------|--------------------------|--------------------------|
| POST   | /api/auth/register       | Create new account       |
| POST   | /api/auth/login          | Login + get JWT token    |
| GET    | /api/auth/me             | Get current user profile |

### Energy
| Method | Route                    | Description              |
|--------|--------------------------|--------------------------|
| GET    | /api/energy/live         | Simulated live reading   |
| GET    | /api/energy/today        | Today's hourly breakdown |
| GET    | /api/energy/weekly       | Last 7 days daily totals |
| GET    | /api/energy/monthly      | Monthly totals           |
| GET    | /api/energy/heatmap      | 7-day × 24-hr matrix     |
| GET    | /api/energy/stats        | Dashboard KPI summary    |

### Bills & Alerts
| Method | Route                    | Description              |
|--------|--------------------------|--------------------------|
| GET    | /api/bills               | User's billing history   |
| GET    | /api/alerts              | All alerts + unread count|
| PATCH  | /api/alerts/:id/read     | Mark one alert as read   |
| PATCH  | /api/alerts/read-all     | Mark all alerts as read  |

### Profile
| Method | Route                    | Description              |
|--------|--------------------------|--------------------------|
| PATCH  | /api/profile             | Update name/address      |
| PATCH  | /api/profile/password    | Change password          |

---

## 🗄️ Database Schema

```sql
users            -- accounts, meter IDs, tariffs
meter_readings   -- timestamped kWh/kW readings per user
monthly_bills    -- billing history per month
alerts           -- notifications and tips per user
```

---

## 🌐 Deploy to the Internet (so anyone can access)

### Option A — Railway (easiest, free)
1. Push this folder to GitHub
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Set environment variable: `JWT_SECRET=your-secret-here`
4. Done! Railway gives you a public URL

### Option B — Render (free tier)
1. Push to GitHub
2. Go to https://render.com → New Web Service
3. Build command: `npm install`
4. Start command: `node server.js`
5. Add env var: `JWT_SECRET=your-secret`

### Option C — VPS / your own server
```bash
# Install Node.js 18+
# Upload project files
npm install
JWT_SECRET=your-secret-key PORT=3000 node server.js

# Use PM2 for production
npm install -g pm2
pm2 start server.js --name wattwise
pm2 save
```

---

## 🔧 Environment Variables
| Variable     | Default                          | Description       |
|--------------|----------------------------------|-------------------|
| PORT         | 3000                             | Server port       |
| JWT_SECRET   | wattwise-secret-change-in-prod   | JWT signing key   |

> ⚠️ Always change JWT_SECRET in production!

---

## 🔒 Security Features
- Passwords hashed with bcrypt (10 salt rounds)
- JWT tokens with 7-day expiry
- Rate limiting: 20 login attempts per 15 minutes
- API rate limiting: 120 requests per minute
- Helmet.js security headers
- Meter ID validated against account on login

---

## 📊 Features
- ✅ User registration & login with meter number
- ✅ Per-user meter data isolation
- ✅ Live power reading simulation (updates every 5s)
- ✅ Animated SVG gauge with needle
- ✅ Sparkline chart (today's hourly usage)
- ✅ Bar charts (daily/weekly/monthly)
- ✅ 7-day × 24-hour heatmap
- ✅ Eco score calculated from real data
- ✅ Bill history chart
- ✅ Alert system with unread badges
- ✅ Fully responsive (desktop + mobile)
- ✅ Auto-login with stored JWT
- ✅ Dark mode UI
