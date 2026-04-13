import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { logAudit } from "@/lib/server/audit";
import { roundMoney } from "@/lib/server/crypto";
import { withTransaction } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import {
  beginIdempotentRequest,
  buildIdempotencyHash,
  completeIdempotentRequest,
  readIdempotencyKey,
} from "@/lib/server/idempotency";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

const duePaymentSchema = z.object({
  amount: z.number().positive("Amount must be greater than 0"),
  sale_id: z.number().int().positive().optional().nullable(),
  note: z.string().max(255).optional().nullable(),
});

interface CustomerRow extends RowDataPacket {
  id: string;
  phone: string;
  due: string;
}

interface SaleDueRow extends RowDataPacket {
  id: number;
  due: string;
}

function decodePhone(phoneParam: string) {
  return decodeURIComponent(phoneParam).trim();
}

function cleanText(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

type AppliedSale = {
  sale_id: number;
  amount: number;
};

type CustomerDuePaymentResponse = {
  customer_id: string;
  customer_phone: string;
  amount: number;
  due_before: number;
  due_after: number;
  allocations: AppliedSale[];
};

type CustomerDuePaymentTxResult = {
  replayed: boolean;
  data: CustomerDuePaymentResponse;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ phone: string }> },
) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "customers", "edit");

    const resolvedParams = await params;
    const phone = decodePhone(resolvedParams.phone);

    if (!phone) {
      throw new ApiError(400, "Customer phone is required");
    }

    const body = await request.json().catch(() => {
      throw new ApiError(400, "Invalid JSON body");
    });

    const parsed = duePaymentSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid due payment payload");
    }

    const payload = parsed.data;
    const idempotencyKey = readIdempotencyKey(request);
    const idempotencyHash = idempotencyKey
      ? buildIdempotencyHash({
        phone,
        amount: payload.amount,
        sale_id: payload.sale_id ?? null,
        note: payload.note ?? null,
      })
      : null;

    const result = await withTransaction<CustomerDuePaymentTxResult>(async (conn) => {
      if (idempotencyKey && idempotencyHash) {
        const replay = await beginIdempotentRequest<CustomerDuePaymentResponse>(conn, {
          userId: user.id,
          scope: "customers.due-payment",
          key: idempotencyKey,
          requestHash: idempotencyHash,
        });

        if (replay.replayed) {
          return {
            replayed: true,
            data: replay.response,
          };
        }
      }

      const [customerRows] = await conn.query<CustomerRow[]>(
        `SELECT id, phone, due
         FROM customers
         WHERE phone = ? AND is_active = 1
         LIMIT 1
         FOR UPDATE`,
        [phone],
      );

      const customer = customerRows[0];
      if (!customer) {
        throw new ApiError(404, "Customer not found");
      }

      const paymentAmount = roundMoney(payload.amount);
      const dueBefore = roundMoney(Number(customer.due));

      if (dueBefore <= 0) {
        throw new ApiError(400, "Customer has no due balance");
      }

      if (paymentAmount > dueBefore) {
        throw new ApiError(400, "Payment amount exceeds customer due balance");
      }

      let remaining = paymentAmount;
      const appliedSales: AppliedSale[] = [];

      if (payload.sale_id) {
        const [saleRows] = await conn.query<SaleDueRow[]>(
          `SELECT id, due
           FROM sales
           WHERE id = ? AND customer_id = ?
           LIMIT 1
           FOR UPDATE`,
          [payload.sale_id, customer.id],
        );

        const sale = saleRows[0];
        if (!sale) {
          throw new ApiError(404, "Sale not found for this customer");
        }

        const saleDue = roundMoney(Number(sale.due));
        if (saleDue <= 0) {
          throw new ApiError(400, "Selected sale has no due");
        }

        if (paymentAmount > saleDue) {
          throw new ApiError(400, "Payment amount exceeds selected sale due");
        }

        await conn.execute(
          `UPDATE sales
           SET paid = paid + ?, due = due - ?
           WHERE id = ?`,
          [paymentAmount, paymentAmount, sale.id],
        );

        appliedSales.push({ sale_id: sale.id, amount: paymentAmount });
        remaining = 0;
      } else {
        const [dueSales] = await conn.query<SaleDueRow[]>(
          `SELECT id, due
           FROM sales
           WHERE customer_id = ? AND due > 0
           ORDER BY created_at ASC, id ASC
           FOR UPDATE`,
          [customer.id],
        );

        for (const sale of dueSales) {
          if (remaining <= 0) {
            break;
          }

          const saleDue = roundMoney(Number(sale.due));
          if (saleDue <= 0) {
            continue;
          }

          const applied = roundMoney(Math.min(remaining, saleDue));
          await conn.execute(
            `UPDATE sales
             SET paid = paid + ?, due = due - ?
             WHERE id = ?`,
            [applied, applied, sale.id],
          );

          appliedSales.push({ sale_id: sale.id, amount: applied });
          remaining = roundMoney(remaining - applied);
        }
      }

      const dueAfter = roundMoney(dueBefore - paymentAmount);

      await conn.execute(
        `UPDATE customers
         SET due = ?, updated_at = NOW()
         WHERE id = ?`,
        [dueAfter, customer.id],
      );

      const note = cleanText(payload.note);

      if (appliedSales.length === 0) {
        await conn.execute(
          `INSERT INTO due_payments (
            id, sale_id, customer_id, amount, note, created_by, created_at
          ) VALUES (UUID(), NULL, ?, ?, ?, ?, NOW())`,
          [customer.id, paymentAmount, note, user.id],
        );
      } else {
        for (const appliedSale of appliedSales) {
          await conn.execute(
            `INSERT INTO due_payments (
              id, sale_id, customer_id, amount, note, created_by, created_at
            ) VALUES (UUID(), ?, ?, ?, ?, ?, NOW())`,
            [appliedSale.sale_id, customer.id, appliedSale.amount, note, user.id],
          );
        }
      }

      await logAudit(
        {
          action: "Due Payment Collected",
          tableName: "due_payments",
          recordId: customer.id,
          detail: `Collected ${paymentAmount.toFixed(2)} for customer ${customer.phone}; allocations: ${appliedSales
            .map((item) => `#${item.sale_id}:${item.amount.toFixed(2)}`)
            .join(", ") || "none"}`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );

      const responsePayload: CustomerDuePaymentResponse = {
        customer_id: customer.id,
        customer_phone: customer.phone,
        amount: paymentAmount,
        due_before: dueBefore,
        due_after: dueAfter,
        allocations: appliedSales,
      };

      if (idempotencyKey && idempotencyHash) {
        await completeIdempotentRequest(conn, {
          userId: user.id,
          scope: "customers.due-payment",
          key: idempotencyKey,
          requestHash: idempotencyHash,
          response: responsePayload,
        });
      }

      return {
        replayed: false,
        data: responsePayload,
      };
    });

    return jsonOk(result.data, result.replayed ? 200 : 201);
  } catch (error) {
    return handleApiError(error);
  }
}
