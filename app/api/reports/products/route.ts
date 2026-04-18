import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { roundMoney } from "@/lib/server/crypto";
import { dbQuery } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

interface ProductProfitRow extends RowDataPacket {
  product_id: string;
  product_name: string;
  total_quantity: number;
  sales_total: string;
  cost_total: string;
  gross_profit: string;
  margin_percent: string;
}

interface ProductCountRow extends RowDataPacket {
  total_count: number;
}

type SortBy = "profit" | "margin";

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

function formatDateKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 29);

  return {
    from: formatDateKey(start),
    to: formatDateKey(end),
  };
}

function parseLimit(input: string | null) {
  const parsed = Number(input ?? 10);
  if (!Number.isFinite(parsed)) {
    return 10;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), 100);
}

function parsePage(input: string | null) {
  const parsed = Number(input ?? 1);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), 100000);
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "reports", "view");

    const { searchParams } = new URL(request.url);
    const defaults = getDefaultRange();

    const from = searchParams.get("from")?.trim() || defaults.from;
    const to = searchParams.get("to")?.trim() || defaults.to;

    if (!isValidDateInput(from) || !isValidDateInput(to)) {
      throw new ApiError(400, "Invalid date range. Use YYYY-MM-DD");
    }

    if (from > to) {
      throw new ApiError(400, "From date cannot be later than to date");
    }

    const sortByParam = searchParams.get("sortBy")?.trim();
    const sortBy: SortBy = sortByParam === "margin" ? "margin" : "profit";
    const limit = parseLimit(searchParams.get("limit"));
    const requestedPage = parsePage(searchParams.get("page"));

    const orderBy =
      sortBy === "margin"
        ? "ORDER BY margin_percent DESC, gross_profit DESC"
        : "ORDER BY gross_profit DESC, margin_percent DESC";

    const countRows = await dbQuery<ProductCountRow[]>(
      `SELECT COUNT(DISTINCT si.product_id) AS total_count
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       WHERE DATE(s.created_at) BETWEEN ? AND ?`,
      [from, to],
    );

    const totalCount = Number(countRows[0]?.total_count ?? 0);
    const totalPages = Math.max(Math.ceil(totalCount / limit), 1);
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * limit;

    const rows = await dbQuery<ProductProfitRow[]>(
      `SELECT
         si.product_id,
         si.product_name,
         COALESCE(SUM(si.quantity), 0) AS total_quantity,
         COALESCE(SUM(si.total), 0) AS sales_total,
         COALESCE(SUM(si.buy_price * si.quantity), 0) AS cost_total,
         COALESCE(SUM((si.sell_price - si.buy_price) * si.quantity), 0) AS gross_profit,
         COALESCE(
           CASE
             WHEN SUM(si.total) > 0 THEN (SUM((si.sell_price - si.buy_price) * si.quantity) / SUM(si.total)) * 100
             ELSE 0
           END,
           0
         ) AS margin_percent
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       WHERE DATE(s.created_at) BETWEEN ? AND ?
       GROUP BY si.product_id, si.product_name
       ${orderBy}
       LIMIT ? OFFSET ?`,
      [from, to, limit, offset],
    );

    const products = rows.map((row, index) => ({
      rank: offset + index + 1,
      product_id: row.product_id,
      product_name: row.product_name,
      total_quantity: Number(row.total_quantity ?? 0),
      sales_total: roundMoney(Number(row.sales_total ?? 0)),
      cost_total: roundMoney(Number(row.cost_total ?? 0)),
      gross_profit: roundMoney(Number(row.gross_profit ?? 0)),
      margin_percent: roundMoney(Number(row.margin_percent ?? 0)),
    }));

    return jsonOk({
      range: {
        from,
        to,
      },
      sort_by: sortBy,
      products,
      meta: {
        count: products.length,
        limit,
        page,
        total_count: totalCount,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
