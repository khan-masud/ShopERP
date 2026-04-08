# ShopERP (Next.js + MySQL)

Security-first ERP for Bangladesh single-owner retail shops.

## Stack

- Next.js 16 (App Router + Route Handlers)
- TypeScript
- MySQL (mysql2 driver)
- JWT auth with httpOnly cookies (access + refresh)
- RBAC permission matrix (admin/staff with module-level view/add/delete)
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
- /expenses
- /stock
- /audit
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
