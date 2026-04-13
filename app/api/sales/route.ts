import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

type QueryParam = string | number | boolean | Date | null;

interface SaleListRow extends RowDataPacket {
  id: number;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string;
  subtotal: string;
  discount_percent: string;
  total: string;
  paid: string;
  due: string;
  note: string | null;
  created_at: Date;
  created_by_name: string | null;
  item_count: number;
  total_quantity: number;
  refund_count: number;
  refunded_quantity: string;
}

interface SalesSummaryRow extends RowDataPacket {
  sale_count: number;
  gross_total: string;
  total_paid: string;
  total_due: string;
}

type RefundFilter = "all" | "refundable" | "refunded";

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

function isValidDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  const candidate = new Date(Date.UTC(year, month - 1, day));

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() + 1 === month &&
    candidate.getUTCDate() === day
  );
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "sales", "view");

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() ?? "";
    const fromDate = searchParams.get("from")?.trim() ?? "";
    const toDate = searchParams.get("to")?.trim() ?? "";
    const dueOnly = searchParams.get("dueOnly") === "1";
    const refundFilter = parseRefundFilter(searchParams.get("refundFilter"));
    const page = parsePositiveInt(searchParams.get("page"), 1, 1000000);
    const pageSize = parsePositiveInt(
      searchParams.get("pageSize") ?? searchParams.get("limit"),
      25,
      200,
    );
    const offset = (page - 1) * pageSize;

    if (fromDate && !isValidDateInput(fromDate)) {
      throw new ApiError(400, "Invalid from date. Use YYYY-MM-DD");
    }

    if (toDate && !isValidDateInput(toDate)) {
      throw new ApiError(400, "Invalid to date. Use YYYY-MM-DD");
    }

    if (fromDate && toDate && fromDate > toDate) {
      throw new ApiError(400, "From date cannot be later than to date");
    }

    const conditions: string[] = [];
    const values: QueryParam[] = [];

    if (query) {
      const parsedId = Number(query);
      const hasSaleId = Number.isInteger(parsedId) && parsedId > 0;

      if (hasSaleId) {
        conditions.push("(s.id = ? OR s.customer_phone LIKE ? OR s.customer_name LIKE ?)");
        values.push(parsedId, `%${query}%`, `%${query}%`);
      } else {
        conditions.push("(s.customer_phone LIKE ? OR s.customer_name LIKE ?)");
        values.push(`%${query}%`, `%${query}%`);
      }
    }

    if (fromDate) {
      conditions.push("s.created_at >= ?");
      values.push(`${fromDate} 00:00:00`);
    }

    if (toDate) {
      conditions.push("s.created_at <= ?");
      values.push(`${toDate} 23:59:59`);
    }

    if (dueOnly) {
      conditions.push("s.due > 0");
    }

    if (refundFilter === "refundable") {
      conditions.push("(COALESCE(si.total_quantity, 0) - COALESCE(rs.refunded_quantity, 0)) > 0");
    }

    if (refundFilter === "refunded") {
      conditions.push("COALESCE(rs.refunded_quantity, 0) > 0");
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const listJoins = `
      LEFT JOIN users u ON u.id = s.created_by
      LEFT JOIN (
        SELECT
          sale_id,
          COALESCE(SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END), 0) AS item_count,
          COALESCE(SUM(quantity), 0) AS total_quantity
        FROM sale_items
        GROUP BY sale_id
      ) si ON si.sale_id = s.id
      LEFT JOIN (
        SELECT
          sale_id,
          COUNT(DISTINCT refund_id) AS refund_count,
          COALESCE(SUM(quantity), 0) AS refunded_quantity
        FROM sale_refund_items
        GROUP BY sale_id
      ) rs ON rs.sale_id = s.id`;

    const summaryJoins = `
      LEFT JOIN (
        SELECT
          sale_id,
          COALESCE(SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END), 0) AS item_count,
          COALESCE(SUM(quantity), 0) AS total_quantity
        FROM sale_items
        GROUP BY sale_id
      ) si ON si.sale_id = s.id
      LEFT JOIN (
        SELECT
          sale_id,
          COUNT(DISTINCT refund_id) AS refund_count,
          COALESCE(SUM(quantity), 0) AS refunded_quantity
        FROM sale_refund_items
        GROUP BY sale_id
      ) rs ON rs.sale_id = s.id`;

    const [sales, summaryRows] = await Promise.all([
      dbQuery<SaleListRow[]>(
        `SELECT
           s.id,
           s.customer_id,
           s.customer_name,
           s.customer_phone,
           s.subtotal,
           s.discount_percent,
           s.total,
           s.paid,
           s.due,
           s.note,
           s.created_at,
           u.name AS created_by_name,
           COALESCE(si.item_count, 0) AS item_count,
           COALESCE(si.total_quantity, 0) AS total_quantity,
           COALESCE(rs.refund_count, 0) AS refund_count,
           COALESCE(rs.refunded_quantity, 0) AS refunded_quantity
         FROM sales s
         ${listJoins}
         ${where}
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT ?
         OFFSET ?`,
        [...values, pageSize, offset],
      ),
      dbQuery<SalesSummaryRow[]>(
        `SELECT
           COUNT(*) AS sale_count,
           COALESCE(SUM(s.total), 0) AS gross_total,
           COALESCE(SUM(s.paid), 0) AS total_paid,
           COALESCE(SUM(s.due), 0) AS total_due
         FROM sales s
         ${summaryJoins}
         ${where}`,
        values,
      ),
    ]);

    const summary = summaryRows[0] ?? {
      sale_count: 0,
      gross_total: "0.00",
      total_paid: "0.00",
      total_due: "0.00",
    };

    const totalCount = Number(summary.sale_count ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    return jsonOk({
      sales,
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

function parseRefundFilter(value: string | null): RefundFilter {
  if (!value || value === "all") {
    return "all";
  }

  if (value === "refundable" || value === "refunded") {
    return value;
  }

  throw new ApiError(400, "Invalid refund filter. Use all, refundable, or refunded");
}