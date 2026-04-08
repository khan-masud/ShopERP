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

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [customers, countRows] = await Promise.all([
      dbQuery<CustomerRow[]>(
        `SELECT
           c.id,
           c.name,
           c.phone,
           c.address,
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
    ]);

    const totalCount = Number(countRows[0]?.total_count ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    return jsonOk({
      customers,
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
