import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { logAudit } from "@/lib/server/audit";
import { roundMoney } from "@/lib/server/crypto";
import { withTransaction } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

const expenseCategories = ["Rent", "Electricity", "Salary", "Purchase", "Transport", "Other"] as const;

const updateExpenseSchema = z.object({
  title: z.string().min(2).max(191),
  amount: z.number().positive("Amount must be greater than 0"),
  category: z.enum(expenseCategories),
  note: z.string().max(255).optional().nullable(),
  expense_date: z.string(),
});

interface ExpenseRow extends RowDataPacket {
  id: string;
  title: string;
  amount: string;
  category: string;
  note: string | null;
  expense_date: string | Date;
  created_at: Date;
  created_by_name: string | null;
  is_deleted: number;
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

function cleanText(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

function parseExpenseId(value: string) {
  const expenseId = decodeURIComponent(value).trim();

  if (!/^[0-9a-fA-F-]{36}$/.test(expenseId)) {
    throw new ApiError(400, "Invalid expense id");
  }

  return expenseId;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ expenseId: string }> },
) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "expenses", "delete");

    const resolvedParams = await params;
    const expenseId = parseExpenseId(resolvedParams.expenseId);

    const deleted = await withTransaction(async (conn) => {
      const [rows] = await conn.query<ExpenseRow[]>(
        `SELECT id, title, amount, category, is_deleted
         FROM expenses
         WHERE id = ? AND is_deleted = 0
         LIMIT 1
         FOR UPDATE`,
        [expenseId],
      );

      const row = rows[0];
      if (!row) {
        throw new ApiError(404, "Expense not found");
      }

      await conn.execute(
        `UPDATE expenses
         SET is_deleted = 1, deleted_at = NOW(), deleted_by = ?
         WHERE id = ?`,
        [user.id, expenseId],
      );

      await logAudit(
        {
          action: "Expense Deleted",
          tableName: "expenses",
          recordId: expenseId,
          detail: `Expense ${row.title} deleted (${row.category}) amount ${row.amount}`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );

      return row;
    });

    return jsonOk({ expense: deleted });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ expenseId: string }> },
) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "expenses", "edit");

    const resolvedParams = await params;
    const expenseId = parseExpenseId(resolvedParams.expenseId);

    const body = await request.json().catch(() => {
      throw new ApiError(400, "Invalid JSON body");
    });

    const parsed = updateExpenseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid expense payload");
    }

    const payload = parsed.data;
    const expenseDate = payload.expense_date.trim();

    if (!isValidDateInput(expenseDate)) {
      throw new ApiError(422, "Invalid expense date. Use YYYY-MM-DD");
    }

    const updatedExpense = await withTransaction(async (conn) => {
      const [rows] = await conn.query<ExpenseRow[]>(
        `SELECT id, title, amount, category, note, expense_date, created_at, is_deleted
         FROM expenses
         WHERE id = ? AND is_deleted = 0
         LIMIT 1
         FOR UPDATE`,
        [expenseId],
      );

      const existing = rows[0];
      if (!existing) {
        throw new ApiError(404, "Expense not found");
      }

      await conn.execute(
        `UPDATE expenses
         SET title = ?, amount = ?, category = ?, note = ?, expense_date = ?
         WHERE id = ?`,
        [
          payload.title.trim(),
          roundMoney(payload.amount),
          payload.category,
          cleanText(payload.note),
          expenseDate,
          expenseId,
        ],
      );

      const [updatedRows] = await conn.query<ExpenseRow[]>(
        `SELECT
           e.id,
           e.title,
           e.amount,
           e.category,
           e.note,
           e.expense_date,
           e.created_at,
           u.name AS created_by_name,
           e.is_deleted
         FROM expenses e
         LEFT JOIN users u ON u.id = e.created_by
         WHERE e.id = ?
         LIMIT 1`,
        [expenseId],
      );

      await logAudit(
        {
          action: "Expense Updated",
          tableName: "expenses",
          recordId: expenseId,
          detail: `Expense updated from ${existing.title} (${existing.category}) amount ${existing.amount}`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );

      return updatedRows[0] ?? null;
    });

    return jsonOk({ expense: updatedExpense });
  } catch (error) {
    return handleApiError(error);
  }
}
