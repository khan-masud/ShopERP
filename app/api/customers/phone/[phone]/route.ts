import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/server/errors";
import { dbQuery } from "@/lib/server/db";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

interface CustomerRow extends RowDataPacket {
  id: string;
  name: string | null;
  phone: string;
  address: string | null;
  note: string | null;
  type: "VIP" | "Regular" | "Wholesale";
  due: string;
  loyalty_points: number;
  is_active: number;
  created_at: Date;
  updated_at: Date;
}

interface SaleRow extends RowDataPacket {
  id: number;
  total: string;
  paid: string;
  due: string;
  discount_percent: string;
  created_at: Date;
}

interface DuePaymentRow extends RowDataPacket {
  id: string;
  sale_id: number | null;
  amount: string;
  note: string | null;
  created_at: Date;
  created_by_name: string | null;
}

interface SummaryRow extends RowDataPacket {
  sale_count: number;
  total_sales: string;
  total_paid: string;
  total_due: string;
  total_due_paid: string;
  last_sale_at: Date | null;
}

function decodePhone(phoneParam: string) {
  return decodeURIComponent(phoneParam).trim();
}

const updateCustomerSchema = z.object({
  phone: z.string().min(8).max(40),
  name: z.string().max(191).nullable().optional(),
  address: z.string().max(255).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

function cleanText(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ phone: string }> },
) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "customers", "view");

    const resolvedParams = await params;
    const phone = decodePhone(resolvedParams.phone);

    if (!phone) {
      throw new ApiError(400, "Customer phone is required");
    }

    const customerRows = await dbQuery<CustomerRow[]>(
      `SELECT id, name, phone, address, note, type, due, loyalty_points, is_active, created_at, updated_at
       FROM customers
       WHERE phone = ?
       LIMIT 1`,
      [phone],
    );

    const customer = customerRows[0];
    if (!customer) {
      throw new ApiError(404, "Customer not found");
    }

    const [sales, outstandingSales, duePayments, summaryRows] = await Promise.all([
      dbQuery<SaleRow[]>(
        `SELECT id, total, paid, due, discount_percent, created_at
         FROM sales
         WHERE customer_id = ?
         ORDER BY created_at DESC
         LIMIT 100`,
        [customer.id],
      ),
      dbQuery<SaleRow[]>(
        `SELECT id, total, paid, due, discount_percent, created_at
         FROM sales
         WHERE customer_id = ? AND due > 0
         ORDER BY created_at ASC, id ASC
         LIMIT 100`,
        [customer.id],
      ),
      dbQuery<DuePaymentRow[]>(
        `SELECT dp.id, dp.sale_id, dp.amount, dp.note, dp.created_at, u.name AS created_by_name
         FROM due_payments dp
         LEFT JOIN users u ON u.id = dp.created_by
         WHERE dp.customer_id = ?
         ORDER BY dp.created_at DESC
         LIMIT 100`,
        [customer.id],
      ),
      dbQuery<SummaryRow[]>(
        `SELECT
           COUNT(s.id) AS sale_count,
           COALESCE(SUM(s.total), 0) AS total_sales,
           COALESCE(SUM(s.paid), 0) AS total_paid,
           COALESCE(SUM(s.due), 0) AS total_due,
           COALESCE((SELECT SUM(dp.amount) FROM due_payments dp WHERE dp.customer_id = ?), 0) AS total_due_paid,
           MAX(s.created_at) AS last_sale_at
         FROM sales s
         WHERE s.customer_id = ?`,
        [customer.id, customer.id],
      ),
    ]);

    return jsonOk({
      customer,
      summary: summaryRows[0] ?? {
        sale_count: 0,
        total_sales: "0.00",
        total_paid: "0.00",
        total_due: "0.00",
        total_due_paid: "0.00",
        last_sale_at: null,
      },
      sales,
      outstanding_sales: outstandingSales,
      due_payments: duePayments,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ phone: string }> },
) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "customers", "edit");

    const resolvedParams = await params;
    const currentPhone = decodePhone(resolvedParams.phone);

    if (!currentPhone) {
      throw new ApiError(400, "Customer phone is required");
    }

    const body = await request.json().catch(() => {
      throw new ApiError(400, "Invalid JSON body");
    });

    const parsed = updateCustomerSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid customer payload");
    }

    const nextPhone = parsed.data.phone.trim();
    const nextName = cleanText(parsed.data.name);
    const nextAddress = cleanText(parsed.data.address);
    const nextNote = cleanText(parsed.data.note);

    if (!nextPhone) {
      throw new ApiError(422, "Customer phone is required");
    }

    const currentRows = await dbQuery<CustomerRow[]>(
      `SELECT id, name, phone, address, note, type, due, loyalty_points, is_active, created_at, updated_at
       FROM customers
       WHERE phone = ?
       LIMIT 1`,
      [currentPhone],
    );

    const existingCustomer = currentRows[0];
    if (!existingCustomer) {
      throw new ApiError(404, "Customer not found");
    }

    if (nextPhone !== currentPhone) {
      const duplicateRows = await dbQuery<Array<RowDataPacket & { id: string }>>(
        `SELECT id
         FROM customers
         WHERE phone = ? AND id <> ?
         LIMIT 1`,
        [nextPhone, existingCustomer.id],
      );

      if (duplicateRows[0]) {
        throw new ApiError(409, "Phone already exists for another customer");
      }
    }

    await dbQuery(
      `UPDATE customers
       SET phone = ?, name = ?, address = ?, note = ?, updated_at = NOW()
       WHERE id = ?`,
      [nextPhone, nextName, nextAddress, nextNote, existingCustomer.id],
    );

    const updatedRows = await dbQuery<CustomerRow[]>(
      `SELECT id, name, phone, address, note, type, due, loyalty_points, is_active, created_at, updated_at
       FROM customers
       WHERE id = ?
       LIMIT 1`,
      [existingCustomer.id],
    );

    const updatedCustomer = updatedRows[0];
    if (!updatedCustomer) {
      throw new ApiError(500, "Failed to load updated customer");
    }

    return jsonOk({
      customer: updatedCustomer,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
