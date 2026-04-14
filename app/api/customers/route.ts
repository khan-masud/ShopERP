import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { dbQuery } from "@/lib/server/db";
import { handleApiError, jsonOk } from "@/lib/server/response";

interface CustomerRow extends RowDataPacket {
  id: string;
  name: string | null;
  phone: string;
  address: string | null;
  note: string | null;
  type: "VIP" | "Regular" | "Wholesale";
  due: string;
  loyalty_points: number;
  is_active: number;
  created_at: Date;
  updated_at: Date;
  sale_count: number;
  total_sales: string;
  total_due_paid: string;
  last_sale_at: Date | null;
}

interface CountRow extends RowDataPacket {
  total_count: number;
}

interface StatsRow extends RowDataPacket {
  total_customers: number;
  total_regular_customers: number;
  customers_with_due: number;
}

interface Sales30dRow extends RowDataPacket {
  total_sell_30d: number;
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

type QueryParam = string | number | boolean | Date | null;

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "customers", "view");

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim();
    const includeInactive = searchParams.get("includeInactive") === "1";
    const dueOnly = searchParams.get("dueOnly") === "1";
    const page = parsePositiveInt(searchParams.get("page"), 1, 1000000);
    const pageSize = parsePositiveInt(
      searchParams.get("pageSize") ?? searchParams.get("limit"),
      25,
      200,
    );
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const values: QueryParam[] = [];

    if (!includeInactive) {
      conditions.push("c.is_active = 1");
    }

    if (query) {
      conditions.push("(c.phone LIKE ? OR c.name LIKE ?)");
      values.push(`%${query}%`, `%${query}%`);
    }

    if (dueOnly) {
      conditions.push("c.due > 0");
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const statsWhere = includeInactive ? "" : "WHERE c.is_active = 1";

    const [customers, countRows, statsRows, sales30dRows] = await Promise.all([
      dbQuery<CustomerRow[]>(
        `SELECT
           c.id,
           c.name,
           c.phone,
           c.address,
           c.note,
           c.type,
           c.due,
           c.loyalty_points,
           c.is_active,
           c.created_at,
           c.updated_at,
           COALESCE(s.sale_count, 0) AS sale_count,
           COALESCE(s.total_sales, 0) AS total_sales,
           COALESCE(dp.total_due_paid, 0) AS total_due_paid,
           s.last_sale_at
         FROM customers c
         LEFT JOIN (
           SELECT customer_id, COUNT(*) AS sale_count, COALESCE(SUM(total), 0) AS total_sales, MAX(created_at) AS last_sale_at
           FROM sales
           GROUP BY customer_id
         ) s ON s.customer_id = c.id
         LEFT JOIN (
           SELECT customer_id, COALESCE(SUM(amount), 0) AS total_due_paid
           FROM due_payments
           GROUP BY customer_id
         ) dp ON dp.customer_id = c.id
         ${where}
         ORDER BY c.updated_at DESC
         LIMIT ?
         OFFSET ?`,
        [...values, pageSize, offset],
      ),
      dbQuery<CountRow[]>(
        `SELECT COUNT(*) AS total_count
         FROM customers c
         ${where}`,
        values,
      ),
      dbQuery<StatsRow[]>(
        `SELECT
           COUNT(*) AS total_customers,
           COALESCE(SUM(CASE WHEN c.type = 'Regular' THEN 1 ELSE 0 END), 0) AS total_regular_customers,
           COALESCE(SUM(CASE WHEN c.due > 0 THEN 1 ELSE 0 END), 0) AS customers_with_due
         FROM customers c
         ${statsWhere}`,
      ),
      dbQuery<Sales30dRow[]>(
        `SELECT
           COUNT(*) AS total_sell_30d
         FROM sales
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      ),
    ]);

    const totalCount = Number(countRows[0]?.total_count ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const stats = statsRows[0];

    return jsonOk({
      customers,
      stats: {
        total_customers: toNumber(stats?.total_customers),
        total_regular_customers: toNumber(stats?.total_regular_customers),
        customers_with_due: toNumber(stats?.customers_with_due),
        total_sell_30d: toNumber(sales30dRows[0]?.total_sell_30d),
      },
      pagination: {
        page,
        page_size: pageSize,
        total_count: totalCount,
        total_pages: totalPages,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
