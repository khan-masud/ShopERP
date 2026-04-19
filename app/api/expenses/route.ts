import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { logAudit } from "@/lib/server/audit";
import { roundMoney } from "@/lib/server/crypto";
import { dbQuery, withTransaction } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

const expenseCategories = ["Rent", "Electricity", "Salary", "Purchase", "Transport", "Other"] as const;
type ExpenseCategory = (typeof expenseCategories)[number];

type QueryParam = string | number | boolean | Date | null;

interface ExpenseRow extends RowDataPacket {
  id: string;
  title: string;
  amount: string;
  category: ExpenseCategory;
  note: string | null;
  expense_date: string | Date;
  created_at: Date;
  created_by_name: string | null;
}

interface SummaryRow extends RowDataPacket {
  expense_count: number;
  total_amount: string;
}

interface CurrentMonthSummaryRow extends RowDataPacket {
  expense_count: number;
  total_amount: string;
}

interface CurrentMonthCategoryRow extends RowDataPacket {
  category: ExpenseCategory;
  total_amount: string;
}

interface CategorySummaryRow extends RowDataPacket {
  category: ExpenseCategory;
  expense_count: number;
  total_amount: string;
}

const createExpenseSchema = z.object({
  title: z.string().min(2).max(191),
  amount: z.number().positive("Amount must be greater than 0"),
  category: z.enum(expenseCategories),
  note: z.string().max(255).optional().nullable(),
  expense_date: z.string(),
});

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

function cleanText(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "expenses", "view");

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() ?? "";
    const categoryParam = searchParams.get("category")?.trim() ?? "";
    const fromDate = searchParams.get("from")?.trim() ?? "";
    const toDate = searchParams.get("to")?.trim() ?? "";

    const parsedLimit = Number(searchParams.get("limit") ?? 200);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(Math.floor(parsedLimit), 1), 500)
      : 200;

    if (fromDate && !isValidDateInput(fromDate)) {
      throw new ApiError(400, "Invalid from date. Use YYYY-MM-DD");
    }

    if (toDate && !isValidDateInput(toDate)) {
      throw new ApiError(400, "Invalid to date. Use YYYY-MM-DD");
    }

    if (fromDate && toDate && fromDate > toDate) {
      throw new ApiError(400, "From date cannot be later than to date");
    }

    if (categoryParam && !expenseCategories.includes(categoryParam as ExpenseCategory)) {
      throw new ApiError(400, "Invalid expense category filter");
    }

    const conditions: string[] = ["e.is_deleted = 0"];
    const values: QueryParam[] = [];

    if (query) {
      conditions.push("(e.title LIKE ? OR e.note LIKE ?)");
      values.push(`%${query}%`, `%${query}%`);
    }

    if (categoryParam) {
      conditions.push("e.category = ?");
      values.push(categoryParam as ExpenseCategory);
    }

    if (fromDate) {
      conditions.push("e.expense_date >= ?");
      values.push(fromDate);
    }

    if (toDate) {
      conditions.push("e.expense_date <= ?");
      values.push(toDate);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [
      expenses,
      summaryRows,
      categoryRows,
      currentMonthSummaryRows,
      currentMonthCategoryRows,
    ] = await Promise.all([
      dbQuery<ExpenseRow[]>(
        `SELECT
           e.id,
           e.title,
           e.amount,
           e.category,
           e.note,
           e.expense_date,
           e.created_at,
           u.name AS created_by_name
         FROM expenses e
         LEFT JOIN users u ON u.id = e.created_by
         ${where}
         ORDER BY e.expense_date DESC, e.created_at DESC
         LIMIT ?`,
        [...values, limit],
      ),
      dbQuery<SummaryRow[]>(
        `SELECT
           COUNT(*) AS expense_count,
           COALESCE(SUM(e.amount), 0) AS total_amount
         FROM expenses e
         ${where}`,
        values,
      ),
      dbQuery<CategorySummaryRow[]>(
        `SELECT
           e.category,
           COUNT(*) AS expense_count,
           COALESCE(SUM(e.amount), 0) AS total_amount
         FROM expenses e
         ${where}
         GROUP BY e.category
         ORDER BY total_amount DESC`,
        values,
      ),
      dbQuery<CurrentMonthSummaryRow[]>(
        `SELECT
           COUNT(*) AS expense_count,
           COALESCE(SUM(e.amount), 0) AS total_amount
         FROM expenses e
         WHERE e.is_deleted = 0
           AND YEAR(e.expense_date) = YEAR(CURDATE())
           AND MONTH(e.expense_date) = MONTH(CURDATE())`,
      ),
      dbQuery<CurrentMonthCategoryRow[]>(
        `SELECT
           e.category,
           COALESCE(SUM(e.amount), 0) AS total_amount
         FROM expenses e
         WHERE e.is_deleted = 0
           AND YEAR(e.expense_date) = YEAR(CURDATE())
           AND MONTH(e.expense_date) = MONTH(CURDATE())
         GROUP BY e.category
         ORDER BY total_amount DESC
         LIMIT 1`,
      ),
    ]);

    const summary = summaryRows[0] ?? { expense_count: 0, total_amount: "0.00" };
    const currentMonthSummary = currentMonthSummaryRows[0] ?? { expense_count: 0, total_amount: "0.00" };
    const currentMonthTopCategory = currentMonthCategoryRows[0] ?? null;

    return jsonOk({
      expenses,
      summary: {
        expense_count: Number(summary.expense_count ?? 0),
        total_amount: roundMoney(Number(summary.total_amount ?? 0)),
        current_month_expense_count: Number(currentMonthSummary.expense_count ?? 0),
        current_month_total_amount: roundMoney(Number(currentMonthSummary.total_amount ?? 0)),
        current_month_top_category: currentMonthTopCategory?.category ?? null,
        current_month_top_category_total_amount: roundMoney(Number(currentMonthTopCategory?.total_amount ?? 0)),
      },
      categories: categoryRows.map((row) => ({
        category: row.category,
        expense_count: Number(row.expense_count ?? 0),
        total_amount: roundMoney(Number(row.total_amount ?? 0)),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "expenses", "add");

    const body = await request.json().catch(() => {
      throw new ApiError(400, "Invalid JSON body");
    });

    const parsed = createExpenseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid expense payload");
    }

    const payload = parsed.data;
    const expenseDate = payload.expense_date.trim();

    if (!isValidDateInput(expenseDate)) {
      throw new ApiError(422, "Invalid expense date. Use YYYY-MM-DD");
    }

    const expenseId = randomUUID();

    const createdExpense = await withTransaction(async (conn) => {
      await conn.execute(
        `INSERT INTO expenses (
          id, title, amount, category, note, expense_date, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          expenseId,
          payload.title.trim(),
          roundMoney(payload.amount),
          payload.category,
          cleanText(payload.note),
          expenseDate,
          user.id,
        ],
      );

      const [rows] = await conn.query<ExpenseRow[]>(
        `SELECT
           e.id,
           e.title,
           e.amount,
           e.category,
           e.note,
           e.expense_date,
           e.created_at,
           u.name AS created_by_name
         FROM expenses e
         LEFT JOIN users u ON u.id = e.created_by
         WHERE e.id = ?
         LIMIT 1`,
        [expenseId],
      );

      await logAudit(
        {
          action: "Expense Added",
          tableName: "expenses",
          recordId: expenseId,
          detail: `Expense ${payload.title.trim()} added (${payload.category}) amount ${roundMoney(payload.amount).toFixed(2)}`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );

      return rows[0] ?? null;
    });

    return jsonOk({ expense: createdExpense }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
