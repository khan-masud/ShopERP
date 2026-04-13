import { randomUUID } from "crypto";
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

const refundSchema = z.object({
  items: z
    .array(
      z.object({
        sale_item_id: z.string().min(10).max(36),
        quantity: z.number().int().positive("Refund quantity must be greater than 0"),
      }),
    )
    .min(1, "Select at least one item to refund")
    .max(100, "Too many items selected for refund"),
  note: z.string().max(255).optional().nullable(),
});

interface SaleRow extends RowDataPacket {
  id: number;
  customer_id: string | null;
  customer_phone: string;
  discount_percent: string;
  subtotal: string;
  total: string;
  paid: string;
  due: string;
}

interface CustomerRow extends RowDataPacket {
  id: string;
  due: string;
  loyalty_points: number;
}

interface SaleItemRow extends RowDataPacket {
  id: string;
  sale_id: number;
  product_id: string;
  product_name: string;
  quantity: number;
  buy_price: string;
  sell_price: string;
  total: string;
}

interface ProductRow extends RowDataPacket {
  id: string;
  stock: number;
}

type RefundLine = {
  sale_item_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  gross_amount: number;
  refund_amount: number;
};

type SaleRefundResponse = {
  sale_id: number;
  refund_id: string;
  refund_lines: RefundLine[];
  gross_refund: number;
  refund_amount: number;
  cash_returned: number;
  sale_subtotal_before: number;
  sale_subtotal_after: number;
  sale_total_before: number;
  sale_total_after: number;
  sale_paid_before: number;
  sale_paid_after: number;
  sale_due_before: number;
  sale_due_after: number;
  customer_due_before: number;
  customer_due_after: number;
  loyalty_points_before: number;
  loyalty_points_after: number;
};

type SaleRefundTxResult = {
  replayed: boolean;
  data: SaleRefundResponse;
};

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

function toMoney(value: unknown) {
  return roundMoney(Number(value ?? 0));
}

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

    const parsed = refundSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid refund payload");
    }

    const payload = parsed.data;
    const idempotencyKey = readIdempotencyKey(request);
    const idempotencyHash = idempotencyKey
      ? buildIdempotencyHash({ saleId, items: payload.items, note: payload.note ?? null })
      : null;

    const result = await withTransaction<SaleRefundTxResult>(async (conn) => {
      if (idempotencyKey && idempotencyHash) {
        const replay = await beginIdempotentRequest<SaleRefundResponse>(conn, {
          userId: user.id,
          scope: "sales.refund",
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

      const [saleRows] = await conn.query<SaleRow[]>(
        `SELECT id, customer_id, customer_phone, discount_percent, subtotal, total, paid, due
         FROM sales
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [saleId],
      );

      const sale = saleRows[0];
      if (!sale) {
        throw new ApiError(404, "Sale not found");
      }

      const requestedItemQuantities = new Map<string, number>();
      for (const item of payload.items) {
        requestedItemQuantities.set(
          item.sale_item_id,
          (requestedItemQuantities.get(item.sale_item_id) ?? 0) + item.quantity,
        );
      }

      const saleItemIds = [...requestedItemQuantities.keys()];
      if (saleItemIds.length === 0) {
        throw new ApiError(400, "Select at least one item to refund");
      }

      const saleItemPlaceholders = saleItemIds.map(() => "?").join(", ");
      const [saleItemRows] = await conn.query<SaleItemRow[]>(
        `SELECT id, sale_id, product_id, product_name, quantity, buy_price, sell_price, total
         FROM sale_items
         WHERE sale_id = ?
           AND id IN (${saleItemPlaceholders})
         FOR UPDATE`,
        [sale.id, ...saleItemIds],
      );

      if (saleItemRows.length !== saleItemIds.length) {
        throw new ApiError(400, "One or more selected sale items are invalid for this sale");
      }

      let customerDueBefore = 0;
      let customerDueAfter = 0;
      let loyaltyPointsBefore = 0;
      let loyaltyPointsAfter = 0;

      let customer: CustomerRow | null = null;
      if (sale.customer_id) {
        const [customerRows] = await conn.query<CustomerRow[]>(
          `SELECT id, due, loyalty_points
           FROM customers
           WHERE id = ?
           LIMIT 1
           FOR UPDATE`,
          [sale.customer_id],
        );

        customer = customerRows[0] ?? null;
      }

      const discountPercent = toMoney(sale.discount_percent);
      const itemRowById = new Map(saleItemRows.map((row) => [row.id, row]));

      const refundLines: RefundLine[] = [];
      let grossRefund = 0;
      let refundAmount = 0;

      for (const [saleItemId, quantityRequested] of requestedItemQuantities.entries()) {
        const saleItem = itemRowById.get(saleItemId);

        if (!saleItem) {
          throw new ApiError(400, "Selected sale item was not found");
        }

        if (quantityRequested > saleItem.quantity) {
          throw new ApiError(
            400,
            `Refund quantity exceeds sold quantity for ${saleItem.product_name}`,
          );
        }

        const grossAmount = toMoney(Number(saleItem.sell_price) * quantityRequested);
        const lineRefundAmount = toMoney(grossAmount * (1 - discountPercent / 100));

        grossRefund = toMoney(grossRefund + grossAmount);
        refundAmount = toMoney(refundAmount + lineRefundAmount);

        const quantityAfter = saleItem.quantity - quantityRequested;

        refundLines.push({
          sale_item_id: saleItem.id,
          product_id: saleItem.product_id,
          product_name: saleItem.product_name,
          quantity: quantityRequested,
          quantity_before: saleItem.quantity,
          quantity_after: quantityAfter,
          gross_amount: grossAmount,
          refund_amount: lineRefundAmount,
        });
      }

      if (refundLines.length === 0 || refundAmount <= 0) {
        throw new ApiError(400, "Refund amount must be greater than zero");
      }

      const saleSubtotalBefore = toMoney(sale.subtotal);
      const saleTotalBefore = toMoney(sale.total);
      const salePaidBefore = toMoney(sale.paid);
      const saleDueBefore = toMoney(sale.due);

      if (refundAmount > saleTotalBefore) {
        throw new ApiError(400, "Refund amount exceeds sale total");
      }

      const saleSubtotalAfter = toMoney(Math.max(saleSubtotalBefore - grossRefund, 0));
      const saleTotalAfter = toMoney(Math.max(saleTotalBefore - refundAmount, 0));
      const salePaidAfter = toMoney(Math.min(salePaidBefore, saleTotalAfter));
      const saleDueAfter = toMoney(Math.max(saleTotalAfter - salePaidAfter, 0));
      const cashReturned = toMoney(Math.max(salePaidBefore - saleTotalAfter, 0));
      const dueReduction = toMoney(Math.max(saleDueBefore - saleDueAfter, 0));

      const loyaltyPointReduction = Math.floor(refundAmount / 50);

      if (customer) {
        customerDueBefore = toMoney(customer.due);
        customerDueAfter = toMoney(Math.max(customerDueBefore - dueReduction, 0));
        loyaltyPointsBefore = Number(customer.loyalty_points ?? 0);
        loyaltyPointsAfter = Math.max(loyaltyPointsBefore - loyaltyPointReduction, 0);
      }

      const refundId = randomUUID();

      await conn.execute(
        `INSERT INTO sale_refunds (
          id, sale_id, customer_id, refund_note, gross_amount, refund_amount, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          refundId,
          sale.id,
          customer?.id ?? null,
          cleanText(payload.note),
          grossRefund,
          refundAmount,
          user.id,
        ],
      );

      for (const line of refundLines) {
        const matchingSaleItem = itemRowById.get(line.sale_item_id);

        if (!matchingSaleItem) {
          throw new ApiError(500, "Failed to process refund line item");
        }

        await conn.execute(
          `UPDATE sale_items
           SET quantity = ?, total = ?
           WHERE id = ?`,
          [
            line.quantity_after,
            toMoney(Number(matchingSaleItem.sell_price) * line.quantity_after),
            line.sale_item_id,
          ],
        );

        const [productRows] = await conn.query<ProductRow[]>(
          `SELECT id, stock
           FROM products
           WHERE id = ?
           LIMIT 1
           FOR UPDATE`,
          [line.product_id],
        );

        const product = productRows[0];
        if (!product) {
          throw new ApiError(404, `Product ${line.product_name} no longer exists`);
        }

        const quantityBefore = Number(product.stock ?? 0);
        const quantityAfter = quantityBefore + line.quantity;

        await conn.execute(
          `UPDATE products
           SET stock = ?, updated_at = NOW()
           WHERE id = ?`,
          [quantityAfter, product.id],
        );

        await conn.execute(
          `INSERT INTO stock_history (
            id, product_id, product_name, change_type,
            quantity_change, quantity_before, quantity_after,
            note, created_by, created_at
          ) VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?, ?, NOW())`,
          [
            randomUUID(),
            line.product_id,
            line.product_name,
            line.quantity,
            quantityBefore,
            quantityAfter,
            `Refund for sale #${sale.id}`,
            user.id,
          ],
        );

        await conn.execute(
          `INSERT INTO sale_refund_items (
            id, refund_id, sale_item_id, sale_id, product_id, product_name,
            quantity, buy_price, sell_price, gross_total, refund_total, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            randomUUID(),
            refundId,
            line.sale_item_id,
            sale.id,
            line.product_id,
            line.product_name,
            line.quantity,
            matchingSaleItem.buy_price,
            matchingSaleItem.sell_price,
            line.gross_amount,
            line.refund_amount,
          ],
        );
      }

      await conn.execute(
        `UPDATE sales
         SET subtotal = ?, total = ?, paid = ?, due = ?
         WHERE id = ?`,
        [saleSubtotalAfter, saleTotalAfter, salePaidAfter, saleDueAfter, sale.id],
      );

      if (customer) {
        await conn.execute(
          `UPDATE customers
           SET due = ?, loyalty_points = ?, updated_at = NOW()
           WHERE id = ?`,
          [customerDueAfter, loyaltyPointsAfter, customer.id],
        );
      }

      await logAudit(
        {
          action: "Sale Refunded",
          tableName: "sale_refunds",
          recordId: refundId,
          detail: `Refunded ${refundAmount.toFixed(2)} on sale #${sale.id} with ${refundLines.length} item lines`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );

      const responsePayload: SaleRefundResponse = {
        sale_id: sale.id,
        refund_id: refundId,
        refund_lines: refundLines,
        gross_refund: grossRefund,
        refund_amount: refundAmount,
        cash_returned: cashReturned,
        sale_subtotal_before: saleSubtotalBefore,
        sale_subtotal_after: saleSubtotalAfter,
        sale_total_before: saleTotalBefore,
        sale_total_after: saleTotalAfter,
        sale_paid_before: salePaidBefore,
        sale_paid_after: salePaidAfter,
        sale_due_before: saleDueBefore,
        sale_due_after: saleDueAfter,
        customer_due_before: customerDueBefore,
        customer_due_after: customerDueAfter,
        loyalty_points_before: loyaltyPointsBefore,
        loyalty_points_after: loyaltyPointsAfter,
      };

      if (idempotencyKey && idempotencyHash) {
        await completeIdempotentRequest(conn, {
          userId: user.id,
          scope: "sales.refund",
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
