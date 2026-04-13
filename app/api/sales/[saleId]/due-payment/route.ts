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
  note: z.string().max(255).optional().nullable(),
});

interface SaleDueRow extends RowDataPacket {
  id: number;
  customer_id: string | null;
  customer_phone: string;
  due: string;
}

interface CustomerDueRow extends RowDataPacket {
  id: string;
  due: string;
}

function parseSaleId(input: string) {
  const saleId = Number(input);
  if (!Number.isInteger(saleId) || saleId <= 0) {
    throw new ApiError(400, "Invalid sale id");
  }

  return saleId;
}

function cleanText(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

type SaleDuePaymentResponse = {
  sale_id: number;
  customer_id: string;
  customer_phone: string;
  amount: number;
  sale_due_before: number;
  sale_due_after: number;
  customer_due_before: number;
  customer_due_after: number;
};

type SaleDuePaymentTxResult = {
  replayed: boolean;
  data: SaleDuePaymentResponse;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ saleId: string }> },
) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "sales", "edit");

    const resolvedParams = await params;
    const saleId = parseSaleId(decodeURIComponent(resolvedParams.saleId));

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
      ? buildIdempotencyHash({ saleId, amount: payload.amount, note: payload.note ?? null })
      : null;

    const result = await withTransaction<SaleDuePaymentTxResult>(async (conn) => {
      if (idempotencyKey && idempotencyHash) {
        const replay = await beginIdempotentRequest<SaleDuePaymentResponse>(conn, {
          userId: user.id,
          scope: "sales.due-payment",
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

      const [saleRows] = await conn.query<SaleDueRow[]>(
        `SELECT
           s.id,
           s.customer_id,
           s.customer_phone,
           s.due
         FROM sales s
         WHERE s.id = ?
         LIMIT 1
         FOR UPDATE`,
        [saleId],
      );

      const sale = saleRows[0];
      if (!sale) {
        throw new ApiError(404, "Sale not found");
      }

      if (!sale.customer_id) {
        throw new ApiError(400, "This sale is missing a customer reference");
      }

      const [customerRows] = await conn.query<CustomerDueRow[]>(
        `SELECT id, due
         FROM customers
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [sale.customer_id],
      );

      const customer = customerRows[0];
      if (!customer) {
        throw new ApiError(400, "Customer reference is invalid for this sale");
      }

      const saleDueBefore = roundMoney(Number(sale.due));
      if (saleDueBefore <= 0) {
        throw new ApiError(400, "Selected sale has no due");
      }

      const paymentAmount = roundMoney(payload.amount);
      if (paymentAmount > saleDueBefore) {
        throw new ApiError(400, "Payment amount exceeds selected sale due");
      }

      const customerDueBefore = roundMoney(Number(customer.due));
      const saleDueAfter = roundMoney(saleDueBefore - paymentAmount);
      const customerDueAfter = roundMoney(Math.max(customerDueBefore - paymentAmount, 0));

      await conn.execute(
        `UPDATE sales
         SET paid = paid + ?, due = due - ?
         WHERE id = ?`,
        [paymentAmount, paymentAmount, sale.id],
      );

      await conn.execute(
        `UPDATE customers
         SET due = ?, updated_at = NOW()
         WHERE id = ?`,
        [customerDueAfter, customer.id],
      );

      await conn.execute(
        `INSERT INTO due_payments (
          id, sale_id, customer_id, amount, note, created_by, created_at
        ) VALUES (UUID(), ?, ?, ?, ?, ?, NOW())`,
        [sale.id, customer.id, paymentAmount, cleanText(payload.note), user.id],
      );

      await logAudit(
        {
          action: "Sale Due Payment Collected",
          tableName: "due_payments",
          recordId: String(sale.id),
          detail: `Collected ${paymentAmount.toFixed(2)} for sale #${sale.id} (${sale.customer_phone})`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );

      const responsePayload: SaleDuePaymentResponse = {
        sale_id: sale.id,
        customer_id: customer.id,
        customer_phone: sale.customer_phone,
        amount: paymentAmount,
        sale_due_before: saleDueBefore,
        sale_due_after: saleDueAfter,
        customer_due_before: customerDueBefore,
        customer_due_after: customerDueAfter,
      };

      if (idempotencyKey && idempotencyHash) {
        await completeIdempotentRequest(conn, {
          userId: user.id,
          scope: "sales.due-payment",
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
