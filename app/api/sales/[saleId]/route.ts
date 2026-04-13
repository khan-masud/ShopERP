import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

interface SaleDetailRow extends RowDataPacket {
  id: number;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string;
  customer_address: string | null;
  subtotal: string;
  discount_percent: string;
  total: string;
  paid: string;
  due: string;
  note: string | null;
  created_at: Date;
  created_by_name: string | null;
  customer_type: "VIP" | "Regular" | "Wholesale" | null;
  customer_due: string | null;
  loyalty_points: number | null;
  tendered: string;
}

interface SaleItemRow extends RowDataPacket {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  buy_price: string;
  sell_price: string;
  total: string;
  created_at: Date;
}

interface DuePaymentRow extends RowDataPacket {
  id: string;
  amount: string;
  note: string | null;
  created_at: Date;
  created_by_name: string | null;
}

interface PaymentSummaryRow extends RowDataPacket {
  total_due_paid: string;
}

interface SaleRefundRow extends RowDataPacket {
  id: string;
  refund_note: string | null;
  gross_amount: string;
  refund_amount: string;
  created_at: Date;
  created_by_name: string | null;
}

interface SaleRefundItemRow extends RowDataPacket {
  id: string;
  refund_id: string;
  sale_item_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  gross_total: string;
  refund_total: string;
  created_at: Date;
}

interface RefundSummaryRow extends RowDataPacket {
  refund_count: number;
  units_refunded: string;
  gross_refunded: string;
  amount_refunded: string;
}

function parseSaleId(input: string) {
  const saleId = Number(input);
  if (!Number.isInteger(saleId) || saleId <= 0) {
    throw new ApiError(400, "Invalid sale id");
  }

  return saleId;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ saleId: string }> },
) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "sales", "view");

    const resolvedParams = await params;
    const saleId = parseSaleId(decodeURIComponent(resolvedParams.saleId));

    const saleRows = await dbQuery<SaleDetailRow[]>(
      `SELECT
         s.id,
         s.customer_id,
         s.customer_name,
         s.customer_phone,
         s.customer_address,
         s.subtotal,
         s.discount_percent,
         s.total,
         s.tendered,
         s.paid,
         s.due,
         s.note,
         s.created_at,
         u.name AS created_by_name,
         c.type AS customer_type,
         c.due AS customer_due,
         c.loyalty_points
       FROM sales s
       LEFT JOIN users u ON u.id = s.created_by
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ?
       LIMIT 1`,
      [saleId],
    );

    const sale = saleRows[0];
    if (!sale) {
      throw new ApiError(404, "Sale not found");
    }

    const [items, duePayments, paymentSummaryRows] = await Promise.all([
      dbQuery<SaleItemRow[]>(
        `SELECT id, product_id, product_name, quantity, buy_price, sell_price, total, created_at
         FROM sale_items
         WHERE sale_id = ?
           AND quantity > 0
         ORDER BY created_at ASC, id ASC`,
        [saleId],
      ),
      dbQuery<DuePaymentRow[]>(
        `SELECT dp.id, dp.amount, dp.note, dp.created_at, u.name AS created_by_name
         FROM due_payments dp
         LEFT JOIN users u ON u.id = dp.created_by
         WHERE dp.sale_id = ?
         ORDER BY dp.created_at DESC
         LIMIT 200`,
        [saleId],
      ),
      dbQuery<PaymentSummaryRow[]>(
        `SELECT COALESCE(SUM(amount), 0) AS total_due_paid
         FROM due_payments
         WHERE sale_id = ?`,
        [saleId],
      ),
    ]);

    let refundRows: SaleRefundRow[] = [];
    let refundItems: SaleRefundItemRow[] = [];
    let refundSummaryRows: RefundSummaryRow[] = [];

    try {
      [refundRows, refundItems, refundSummaryRows] = await Promise.all([
        dbQuery<SaleRefundRow[]>(
          `SELECT sr.id, sr.refund_note, sr.gross_amount, sr.refund_amount, sr.created_at, u.name AS created_by_name
           FROM sale_refunds sr
           LEFT JOIN users u ON u.id = sr.created_by
           WHERE sr.sale_id = ?
           ORDER BY sr.created_at DESC`,
          [saleId],
        ),
        dbQuery<SaleRefundItemRow[]>(
          `SELECT id, refund_id, sale_item_id, product_id, product_name, quantity, gross_total, refund_total, created_at
           FROM sale_refund_items
           WHERE sale_id = ?
           ORDER BY created_at DESC, id DESC`,
          [saleId],
        ),
        dbQuery<RefundSummaryRow[]>(
          `SELECT
             COUNT(DISTINCT refund_id) AS refund_count,
             COALESCE(SUM(quantity), 0) AS units_refunded,
             COALESCE(SUM(gross_total), 0) AS gross_refunded,
             COALESCE(SUM(refund_total), 0) AS amount_refunded
           FROM sale_refund_items
           WHERE sale_id = ?`,
          [saleId],
        ),
      ]);
    } catch {
      // Refund tables may not exist before migration is applied; keep detail API usable.
      refundRows = [];
      refundItems = [];
      refundSummaryRows = [];
    }

    const refundItemsById = new Map<string, SaleRefundItemRow[]>();
    for (const row of refundItems) {
      if (!refundItemsById.has(row.refund_id)) {
        refundItemsById.set(row.refund_id, []);
      }

      refundItemsById.get(row.refund_id)?.push(row);
    }

    const refunds = refundRows.map((refund) => ({
      id: refund.id,
      refund_note: refund.refund_note,
      gross_amount: refund.gross_amount,
      refund_amount: refund.refund_amount,
      created_at: refund.created_at,
      created_by_name: refund.created_by_name,
      items: refundItemsById.get(refund.id) ?? [],
    }));

    const refundSummary = refundSummaryRows[0] ?? {
      refund_count: 0,
      units_refunded: "0.00",
      gross_refunded: "0.00",
      amount_refunded: "0.00",
    };

    return jsonOk({
      sale,
      items,
      due_payments: duePayments,
      payment_summary: paymentSummaryRows[0] ?? { total_due_paid: "0.00" },
      refunds,
      refund_summary: refundSummary,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
