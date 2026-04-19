import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/server/errors";
import { dbQuery } from "@/lib/server/db";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

type QueryParam = string | number | boolean | Date | null;

interface AuditLogRow extends RowDataPacket {
  id: string;
  action: string;
  table_name: string | null;
  record_id: string | null;
  detail: string;
  user_name: string | null;
  user_email: string | null;
  ip_address: string | null;
  created_at: Date;
}

interface AuditCountRow extends RowDataPacket {
  total_count: number;
}

interface DistinctValueRow extends RowDataPacket {
  value: string | null;
}

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
    candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() + 1 === month
    && candidate.getUTCDate() === day
  );
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "audit", "view");

    const { searchParams } = new URL(request.url);

    const query = searchParams.get("q")?.trim() ?? "";
    const action = searchParams.get("action")?.trim() ?? "";
    const table = searchParams.get("table")?.trim() ?? "";
    const userName = searchParams.get("userName")?.trim() ?? "";
    const fromDate = searchParams.get("from")?.trim() ?? "";
    const toDate = searchParams.get("to")?.trim() ?? "";

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
      conditions.push("(l.action LIKE ? OR l.detail LIKE ? OR l.user_email LIKE ? OR l.record_id LIKE ?)");
      values.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
    }

    if (action) {
      conditions.push("l.action LIKE ?");
      values.push(`%${action}%`);
    }

    if (table) {
      conditions.push("l.table_name LIKE ?");
      values.push(`%${table}%`);
    }

    if (userName) {
      conditions.push("u.name LIKE ?");
      values.push(`%${userName}%`);
    }

    if (fromDate) {
      conditions.push("l.created_at >= ?");
      values.push(`${fromDate} 00:00:00`);
    }

    if (toDate) {
      conditions.push("l.created_at <= ?");
      values.push(`${toDate} 23:59:59`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [logs, countRows, actionRows, tableRows, userNameRows] = await Promise.all([
      dbQuery<AuditLogRow[]>(
        `SELECT
           l.id,
           l.action,
           l.table_name,
           l.record_id,
           l.detail,
           u.name AS user_name,
           l.user_email,
           l.ip_address,
           l.created_at
         FROM audit_logs l
         LEFT JOIN users u ON u.id = l.user_id
         ${where}
         ORDER BY l.created_at DESC
         LIMIT ?
         OFFSET ?`,
        [...values, pageSize, offset],
      ),
      dbQuery<AuditCountRow[]>(
        `SELECT COUNT(*) AS total_count
         FROM audit_logs l
         LEFT JOIN users u ON u.id = l.user_id
         ${where}`,
        values,
      ),
      dbQuery<DistinctValueRow[]>(
        `SELECT DISTINCT action AS value
         FROM audit_logs
         WHERE action IS NOT NULL AND action <> ''
         ORDER BY action ASC
         LIMIT 500`,
      ),
      dbQuery<DistinctValueRow[]>(
        `SELECT DISTINCT table_name AS value
         FROM audit_logs
         WHERE table_name IS NOT NULL AND table_name <> ''
         ORDER BY table_name ASC
         LIMIT 500`,
      ),
      dbQuery<DistinctValueRow[]>(
        `SELECT DISTINCT u.name AS value
         FROM audit_logs l
         INNER JOIN users u ON u.id = l.user_id
         WHERE u.name IS NOT NULL AND u.name <> ''
         ORDER BY u.name ASC
         LIMIT 500`,
      ),
    ]);

    const totalCount = Number(countRows[0]?.total_count ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    return jsonOk({
      logs,
      total_count: totalCount,
      page,
      page_size: pageSize,
      total_pages: totalPages,
      filter_options: {
        actions: actionRows.map((row) => String(row.value ?? "")).filter(Boolean),
        tables: tableRows.map((row) => String(row.value ?? "")).filter(Boolean),
        user_names: userNameRows.map((row) => String(row.value ?? "")).filter(Boolean),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
