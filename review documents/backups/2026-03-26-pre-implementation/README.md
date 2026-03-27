# 🪟 WinClean – Window Cleaning Schedule App

A mobile-first window cleaning round management app. Track customers, schedule jobs, manage payments, and handle rolling due dates.

## Features

- **Dashboard** – at-a-glance view of today's round, outstanding jobs, and debt
- **Schedule** – plan work days, assign areas, add/remove jobs per day
- **Day View** – mobile-first checklist, tap to complete; Complete Day modal resolves pending jobs (skip / outstanding / move to another day)
- **Rolling Schedule** – next due date recalculates from actual completion, not a fixed calendar anchor
- **Customers** – grouped by area, full job history, reschedule, notes
- **Outstanding Jobs** – jobs not resolved on their day, can be marked done or skipped at any time
- **Payments** – log cash/BACS/card, view per-customer balance, debt list

---

## Local Development

```bash
npm install
npx prisma migrate dev       # creates dev.db
npm run seed                 # demo: 4 areas · 84 customers · 6 work days
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---
## Production Rollout

See `review documents/SAAS_ROLLOUT_PLAN.md` for the current pre-deployment requirements, VPS deployment approach, and staged rollout plan. The Hostinger deployment section below reflects the older SQLite-based setup and should not be used as the final production runbook.


## Hostinger Deployment (Business/Premium Node.js Hosting)

### 1. Upload project
Upload everything **except** `node_modules/`, `.next/`, and `dev.db`.

### 2. Set environment variables in hPanel
```
DATABASE_URL=file:./prod.db
NODE_ENV=production
```

### 3. Install & build on server (SSH or hPanel terminal)
```bash
npm install --production=false
npx prisma migrate deploy
npm run build
```

### 4. Configure startup
- **Startup file**: `node_modules/.bin/next`  
- **Command arguments**: `start`  
- Hostinger will inject `PORT` automatically — Next.js reads it.

### 5. Database backup
The whole database is the file `prod.db` in the project root. Download it via FTP/hPanel File Manager to back up.

---

## Scheduling Rules

| Job outcome | Next due date |
|---|---|
| COMPLETE | `completedAt + frequencyWeeks` |
| SKIPPED | `workDayDate + frequencyWeeks` (schedule stays on track) |
| OUTSTANDING | `workDayDate + frequencyWeeks` (same as skip) |
| MOVED then done | `newCompletionDate + frequencyWeeks` |
| Manual reschedule | Any date you set |

---

## Stack

Next.js 16 · Tailwind CSS v4 · Prisma 7 · better-sqlite3 · date-fns · lucide-react

