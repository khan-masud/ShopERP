import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
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

const checkoutSchema = z.object({
  customer_phone: z.string().min(8).max(40),
  customer_name: z.string().max(191).optional().nullable(),
  customer_address: z.string().max(255).optional().nullable(),
  discount_percent: z.number().min(0).max(100).default(0),
  paid: z.number().min(0).default(0),
  note: z.string().max(1500).optional().nullable(),
  items: z
    .array(
      z.object({
        product_id: z.string().min(10).max(36),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

interface CustomerRow extends RowDataPacket {
  id: string;
  name: string | null;
  address: string | null;
  due: string;
  loyalty_points: number;
}

interface ProductRow extends RowDataPacket {
  id: string;
  name: string;
  buy_price: string;
  sell_price: string;
  stock: number;
  is_active: number;
}

interface SpendRow extends RowDataPacket {
  total_spent: string;
}

type PreparedItem = {
  productId: string;
  productName: string;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  lineTotal: number;
  quantityBefore: number;
  quantityAfter: number;
};

type CheckoutResponse = {
  sale_id: number;
  customer_id: string;
  customer_phone: string;
  subtotal: number;
  discount_percent: number;
  total: number;
  tendered: number;
  paid: number;
  due: number;
  change: number;
  loyalty_earned: number;
  items: Array<{
    product_id: string;
    product_name: string;
    quantity: number;
    sell_price: number;
    total: number;
  }>;
};

type CheckoutTxResult = {
  replayed: boolean;
  data: CheckoutResponse;
};

function cleanText(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "sales", "add");

    const body = await request.json().catch(() => {
      throw new ApiError(400, "Invalid JSON body");
    });

    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid checkout payload");
    }

    const payload = parsed.data;
    const idempotencyKey = readIdempotencyKey(request);
    const idempotencyHash = idempotencyKey ? buildIdempotencyHash(payload) : null;

    const result = await withTransaction<CheckoutTxResult>(async (conn) => {
      if (idempotencyKey && idempotencyHash) {
        const replay = await beginIdempotentRequest<CheckoutResponse>(conn, {
          userId: user.id,
          scope: "sales.checkout",
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

      const customerPhone = payload.customer_phone.trim();
      let customerNameSnapshot = cleanText(payload.customer_name);
      let customerAddressSnapshot = cleanText(payload.customer_address);
      let customerId: string;

      const [customerRows] = await conn.query<CustomerRow[]>(
        `SELECT id, name, address, due, loyalty_points
         FROM customers
         WHERE phone = ?
         LIMIT 1
         FOR UPDATE`,
        [customerPhone],
      );

      const existingCustomer = customerRows[0];

      if (existingCustomer) {
        customerId = existingCustomer.id;

        customerNameSnapshot = customerNameSnapshot ?? existingCustomer.name;
        customerAddressSnapshot = customerAddressSnapshot ?? existingCustomer.address;

        await conn.execute(
          `UPDATE customers
           SET name = ?, address = ?, updated_at = NOW()
           WHERE id = ?`,
          [customerNameSnapshot, customerAddressSnapshot, customerId],
        );
      } else {
        await conn.execute(
          `INSERT INTO customers (
            id, name, phone, address, type, due, loyalty_points, is_active, created_at, updated_at
          ) VALUES (UUID(), ?, ?, ?, 'Regular', 0, 0, 1, NOW(), NOW())`,
          [customerNameSnapshot, customerPhone, customerAddressSnapshot],
        );

        const [newCustomerRows] = await conn.query<CustomerRow[]>(
          `SELECT id, name, address, due, loyalty_points
           FROM customers
           WHERE phone = ?
           LIMIT 1`,
          [customerPhone],
        );

        if (!newCustomerRows[0]) {
          throw new ApiError(500, "Failed to create customer");
        }

        customerId = newCustomerRows[0].id;
        customerNameSnapshot = customerNameSnapshot ?? newCustomerRows[0].name;
        customerAddressSnapshot = customerAddressSnapshot ?? newCustomerRows[0].address;
      }

      const preparedItems: PreparedItem[] = [];
      let subtotal = 0;

      for (const item of payload.items) {
        const [productRows] = await conn.query<ProductRow[]>(
          `SELECT id, name, buy_price, sell_price, stock, is_active
           FROM products
           WHERE id = ?
           LIMIT 1
           FOR UPDATE`,
          [item.product_id],
        );

        const product = productRows[0];

        if (!product || product.is_active !== 1) {
          throw new ApiError(404, `Product ${item.product_id} not found`);
        }

        if (product.stock < item.quantity) {
          throw new ApiError(400, `Insufficient stock for ${product.name}`);
        }

        const sellPrice = Number(product.sell_price);
        const buyPrice = Number(product.buy_price);
        const lineTotal = roundMoney(sellPrice * item.quantity);
        const quantityAfter = product.stock - item.quantity;

        preparedItems.push({
          productId: product.id,
          productName: product.name,
          quantity: item.quantity,
          buyPrice,
          sellPrice,
          lineTotal,
          quantityBefore: product.stock,
          quantityAfter,
        });

        subtotal = roundMoney(subtotal + lineTotal);
      }

      const discountPercent = payload.discount_percent ?? 0;
      const discountAmount = roundMoney((subtotal * discountPercent) / 100);
      const total = roundMoney(Math.max(subtotal - discountAmount, 0));
      const tendered = roundMoney(payload.paid ?? 0);
      const paid = roundMoney(Math.min(tendered, total));
      const due = roundMoney(Math.max(total - paid, 0));
      const change = roundMoney(Math.max(tendered - total, 0));

      const [saleResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO sales (
          customer_id, customer_name, customer_phone, customer_address,
          subtotal, discount_percent, total, paid, due, note,
          created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          customerId,
          customerNameSnapshot,
          customerPhone,
          customerAddressSnapshot,
          subtotal,
          discountPercent,
          total,
          paid,
          due,
          cleanText(payload.note),
          user.id,
        ],
      );

      const saleId = saleResult.insertId;

      for (const item of preparedItems) {
        await conn.execute(
          `INSERT INTO sale_items (
            id, sale_id, product_id, product_name,
            quantity, buy_price, sell_price, total, created_at
          ) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            saleId,
            item.productId,
            item.productName,
            item.quantity,
            item.buyPrice,
            item.sellPrice,
            item.lineTotal,
          ],
        );

        await conn.execute(
          `UPDATE products
           SET stock = ?, updated_at = NOW()
           WHERE id = ?`,
          [item.quantityAfter, item.productId],
        );

        await conn.execute(
          `INSERT INTO stock_history (
            id, product_id, product_name, change_type,
            quantity_change, quantity_before, quantity_after,
            note, created_by, created_at
          ) VALUES (UUID(), ?, ?, 'sale', ?, ?, ?, ?, ?, NOW())`,
          [
            item.productId,
            item.productName,
            -item.quantity,
            item.quantityBefore,
            item.quantityAfter,
            `Sale #${saleId}`,
            user.id,
          ],
        );
      }

      if (due > 0) {
        await conn.execute(
          `UPDATE customers
           SET due = due + ?, updated_at = NOW()
           WHERE id = ?`,
          [due, customerId],
        );
      }

      const loyaltyEarned = Math.floor(total / 50);
      if (loyaltyEarned > 0) {
        await conn.execute(
          `UPDATE customers
           SET loyalty_points = loyalty_points + ?, updated_at = NOW()
           WHERE id = ?`,
          [loyaltyEarned, customerId],
        );
      }

      const [spendRows] = await conn.query<SpendRow[]>(
        `SELECT COALESCE(SUM(total), 0) AS total_spent
         FROM sales
         WHERE customer_id = ?`,
        [customerId],
      );

      if (Number(spendRows[0]?.total_spent ?? 0) > 10000) {
        await conn.execute(
          `UPDATE customers
           SET type = 'VIP', updated_at = NOW()
           WHERE id = ?`,
          [customerId],
        );
      }

      await logAudit(
        {
          action: "Sale Created",
          tableName: "sales",
          recordId: String(saleId),
          detail: `Sale #${saleId} created with total ${total.toFixed(2)} and ${preparedItems.length} items`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );

      const responsePayload: CheckoutResponse = {
        sale_id: saleId,
        customer_id: customerId,
        customer_phone: customerPhone,
        subtotal,
        discount_percent: discountPercent,
        total,
        tendered,
        paid,
        due,
        change,
        loyalty_earned: loyaltyEarned,
        items: preparedItems.map((item) => ({
          product_id: item.productId,
          product_name: item.productName,
          quantity: item.quantity,
          sell_price: item.sellPrice,
          total: item.lineTotal,
        })),
      };

      if (idempotencyKey && idempotencyHash) {
        await completeIdempotentRequest(conn, {
          userId: user.id,
          scope: "sales.checkout",
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
