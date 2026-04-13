import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { requireUserFromRequest, type SessionUser } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

type QueryParam = string | number | boolean | Date | null;

type RangeFilter = "day" | "week" | "month" | "year" | "all";

interface StaffSummaryRow extends RowDataPacket {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  is_active: number;
  sale_count: number;
  total_sales: string;
  total_paid: string;
  total_due: string;
  last_sale_at: Date | null;
}

interface CountRow extends RowDataPacket {
  total_count: number;
}

interface SummaryRow extends RowDataPacket {
  total_staff: number;
  sale_count: number;
  total_sales: string;
  total_paid: string;
  total_due: string;
}

function assertAdmin(user: SessionUser) {
  if (user.role !== "admin") {
    throw new ApiError(403, "Only admin can access staff summary");
  }
}

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

function parseRange(value: string | null): RangeFilter {
  const normalized = (value ?? "month").trim().toLowerCase();

  if (normalized === "day" || normalized === "week" || normalized === "month" || normalized === "year" || normalized === "all") {
    return normalized;
  }

  return "month";
}

function getSalesDateCondition(range: RangeFilter) {
  if (range === "day") {
    return "DATE(s.created_at) = CURRENT_DATE";
  }

  if (range === "week") {
    return "YEARWEEK(s.created_at, 1) = YEARWEEK(CURRENT_DATE, 1)";
  }

  if (range === "month") {
    return "YEAR(s.created_at) = YEAR(CURRENT_DATE) AND MONTH(s.created_at) = MONTH(CURRENT_DATE)";
  }

  if (range === "year") {
    return "YEAR(s.created_at) = YEAR(CURRENT_DATE)";
  }

  return "1 = 1";
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    assertAdmin(user);

    const { searchParams } = new URL(request.url);

    const query = searchParams.get("q")?.trim() ?? "";
    const includeInactive = searchParams.get("includeInactive") === "1";
    const range = parseRange(searchParams.get("range"));

    const page = parsePositiveInt(searchParams.get("page"), 1, 1000000);
    const pageSize = parsePositiveInt(
      searchParams.get("pageSize") ?? searchParams.get("limit"),
      25,
      200,
    );
    const offset = (page - 1) * pageSize;

    const userConditions: string[] = ["u.role = 'staff'"];
    const values: QueryParam[] = [];

    if (!includeInactive) {
      userConditions.push("u.is_active = 1");
    }

    if (query) {
      userConditions.push("(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)");
      values.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }

    const userWhere = `WHERE ${userConditions.join(" AND ")}`;
    const salesDateCondition = getSalesDateCondition(range);

    const [staffRows, countRows, summaryRows] = await Promise.all([
      dbQuery<StaffSummaryRow[]>(
        `SELECT
           u.id,
           u.name,
           u.email,
           u.phone,
           u.is_active,
           COUNT(s.id) AS sale_count,
           COALESCE(SUM(s.total), 0) AS total_sales,
           COALESCE(SUM(s.paid), 0) AS total_paid,
           COALESCE(SUM(s.due), 0) AS total_due,
           MAX(s.created_at) AS last_sale_at
         FROM users u
         LEFT JOIN sales s
           ON s.created_by = u.id
          AND ${salesDateCondition}
         ${userWhere}
         GROUP BY u.id, u.name, u.email, u.phone, u.is_active
         ORDER BY total_sales DESC, sale_count DESC, u.name ASC
         LIMIT ?
         OFFSET ?`,
        [...values, pageSize, offset],
      ),
      dbQuery<CountRow[]>(
        `SELECT COUNT(*) AS total_count
         FROM users u
         ${userWhere}`,
        values,
      ),
      dbQuery<SummaryRow[]>(
        `SELECT
           COUNT(*) AS total_staff,
           COALESCE(SUM(agg.sale_count), 0) AS sale_count,
           COALESCE(SUM(agg.total_sales), 0) AS total_sales,
           COALESCE(SUM(agg.total_paid), 0) AS total_paid,
           COALESCE(SUM(agg.total_due), 0) AS total_due
         FROM (
           SELECT
             u.id,
             COUNT(s.id) AS sale_count,
             COALESCE(SUM(s.total), 0) AS total_sales,
             COALESCE(SUM(s.paid), 0) AS total_paid,
             COALESCE(SUM(s.due), 0) AS total_due
           FROM users u
           LEFT JOIN sales s
             ON s.created_by = u.id
            AND ${salesDateCondition}
           ${userWhere}
           GROUP BY u.id
         ) agg`,
        values,
      ),
    ]);

    const totalCount = Number(countRows[0]?.total_count ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    const summary = summaryRows[0] ?? {
      total_staff: 0,
      sale_count: 0,
      total_sales: "0.00",
      total_paid: "0.00",
      total_due: "0.00",
    };

    return jsonOk({
      staffs: staffRows,
      range,
      summary,
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
