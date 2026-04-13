import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { logAudit } from "@/lib/server/audit";
import { withTransaction } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

interface ExpenseRow extends RowDataPacket {
  id: string;
  title: string;
  amount: string;
  category: string;
  is_deleted: number;
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
