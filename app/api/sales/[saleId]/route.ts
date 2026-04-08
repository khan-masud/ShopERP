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

    return jsonOk({
      sale,
      items,
      due_payments: duePayments,
      payment_summary: paymentSummaryRows[0] ?? { total_due_paid: "0.00" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
