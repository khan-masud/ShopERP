# ShopERP (Next.js + MySQL)

Security-first ERP for Bangladesh single-owner retail shops.

## Stack

- Next.js 16 (App Router + Route Handlers)
- TypeScript
- MySQL (mysql2 driver)
- JWT auth with httpOnly cookies (access + refresh)
- RBAC permission matrix (admin/staff with module-level view/add/edit/delete)
- React Query + Zustand + Tailwind

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
copy .env.example .env.local
```

3. Update database and secret values in .env.local.

4. Apply schema:

```bash
npm run db:apply
```

5. Seed admin user:

```bash
npm run db:seed
```

6. Run dev server:

```bash
npm run dev
```

Open http://localhost:3000

## Security Highlights

- JWT access and refresh tokens in httpOnly cookies.
- Refresh token rotation with token hash storage and revocation.
- Login/logout tracked in login_history.
- Every mutation writes audit log.
- Role-based permissions from role_permissions table.
- Secure headers in next.config.ts.

## Important Routes

- /login
- /dashboard
- /products
- /pos
- /customers
- /sales
- /reports
- /analytics
- /expenses
- /stock
- /audit
- /staff-summary (admin)
- /users (admin)
- /permissions (admin)

## API Modules Implemented

- Auth:
	- POST /api/auth/login
	- POST /api/auth/logout
	- POST /api/auth/refresh
	- GET /api/auth/me
- Products:
	- GET /api/products
	- POST /api/products
- Customers:
	- GET /api/customers
	- GET /api/customers/phone/{phone}
	- POST /api/customers/phone/{phone}/due-payment
- Sales:
	- GET /api/sales
	- GET /api/sales/{saleId}
	- POST /api/sales/{saleId}/due-payment
	- POST /api/sales/checkout
- Reports:
	- GET /api/reports/overview
	- GET /api/reports/range
	- GET /api/reports/products
- Expenses:
	- GET /api/expenses
	- POST /api/expenses
	- DELETE /api/expenses/{expenseId}
- Stock:
	- GET /api/stock
	- POST /api/stock
- Audit:
	- GET /api/audit
- Staff Summary (admin):
	- GET /api/staff-summary
- Permissions (admin):
	- GET /api/permissions
	- PUT /api/permissions
- Staff Users (admin):
	- GET /api/users
	- POST /api/users
	- PATCH /api/users/{userId}

## Pagination Notes

- Server-side pagination is implemented for:
	- /api/audit
	- /api/stock (history)
	- /api/products
	- /api/customers
	- /api/sales
- Query params:
	- page
	- pageSize

## Database Files

- Schema: database/migrations/001_init.sql
- Apply script: scripts/apply-schema.ts
- Admin seed script: scripts/seed-admin.ts

## Test & Validation

- Lint:
	- npm run lint
- Smoke tests:
	- npm run test:smoke
	- Requires running app and env values:
		- SMOKE_BASE_URL
		- SMOKE_ADMIN_EMAIL
		- SMOKE_ADMIN_PASSWORD

## Shared Hosting Note

This project avoids Prisma by design for easier shared-hosting compatibility.
Use Node.js-enabled shared hosting and connect to MySQL via DATABASE_URL or DB_* vars.

## Production Database Pooling

To avoid MySQL "Too many connections" issues in production, keep pool limits conservative and bounded.

- Core env vars:
	- DB_POOL_LIMIT (default: 5)
	- DB_POOL_QUEUE_LIMIT (default: 200)
	- DB_CONNECT_TIMEOUT_MS (default: 10000)
	- DB_RETRY_MAX_ATTEMPTS (default: 3)
	- DB_RETRY_BASE_DELAY_MS (default: 120)
- Sizing rule:
	- per_instance_pool <= floor((max_connections - reserved_connections) / app_instances)
	- Keep reserved_connections for admin tools and migrations (commonly 10-20).
	- Example: max_connections=60, reserved=15, instances=3 => per-instance pool <= 15.
- Operational guidance:
	- Run exactly one app process per expected pool size budget.
	- Use a process manager (PM2/systemd) to avoid duplicate app workers.
	- If horizontally scaling, recalculate DB_POOL_LIMIT for each instance.
