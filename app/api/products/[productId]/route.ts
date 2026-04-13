import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { logAudit } from "@/lib/server/audit";
import { withTransaction } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonError, jsonOk } from "@/lib/server/response";

const categories = [
  "Food",
  "Beverages",
  "Cleaning",
  "Personal Care",
  "Snacks",
  "Household",
  "Other",
] as const;

const updateProductSchema = z.object({
  name: z.string().min(2).max(191),
  category: z.enum(categories),
  sku: z.string().max(100).optional(),
  unit: z.string().max(30),
  buy_price: z.number().nonnegative(),
  sell_price: z.number().positive(),
  min_stock: z.number().int().nonnegative(),
  supplier: z.string().max(191).optional().nullable(),
  expiry_date: z.string().optional().nullable(),
});

interface ProductRow extends RowDataPacket {
  id: string;
  name: string;
  category: (typeof categories)[number];
  sku: string;
  unit: string;
  buy_price: string;
  sell_price: string;
  stock: number;
  min_stock: number;
  supplier: string | null;
  expiry_date: string | null;
  is_active: number;
  created_at: Date;
  updated_at: Date;
}

function parseProductId(value: string) {
  const productId = decodeURIComponent(value).trim();

  if (!/^[0-9a-fA-F-]{36}$/.test(productId)) {
    throw new ApiError(400, "Invalid product id");
  }

  return productId;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "products", "edit");

    const resolvedParams = await params;
    const productId = parseProductId(resolvedParams.productId);

    const body = await request.json().catch(() => {
      throw new ApiError(400, "Invalid JSON body");
    });

    const parsed = updateProductSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid product payload");
    }

    const payload = parsed.data;

    const updatedProduct = await withTransaction(async (conn) => {
      const [rows] = await conn.query<ProductRow[]>(
        `SELECT
           id,
           name,
           category,
           sku,
           unit,
           buy_price,
           sell_price,
           stock,
           min_stock,
           supplier,
           expiry_date,
           is_active,
           created_at,
           updated_at
         FROM products
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [productId],
      );

      const existing = rows[0];
      if (!existing) {
        throw new ApiError(404, "Product not found");
      }

      const targetSku = payload.sku?.trim().toUpperCase() || existing.sku;

      await conn.execute(
        `UPDATE products
         SET
           name = ?,
           category = ?,
           sku = ?,
           unit = ?,
           buy_price = ?,
           sell_price = ?,
           min_stock = ?,
           supplier = ?,
           expiry_date = ?,
           updated_at = NOW()
         WHERE id = ?`,
        [
          payload.name.trim(),
          payload.category,
          targetSku,
          payload.unit.trim(),
          payload.buy_price,
          payload.sell_price,
          payload.min_stock,
          payload.supplier?.trim() || null,
          payload.expiry_date || null,
          productId,
        ],
      );

      const [updatedRows] = await conn.query<ProductRow[]>(
        `SELECT
           id,
           name,
           category,
           sku,
           unit,
           buy_price,
           sell_price,
           stock,
           min_stock,
           supplier,
           expiry_date,
           is_active,
           created_at,
           updated_at
         FROM products
         WHERE id = ?
         LIMIT 1`,
        [productId],
      );

      await logAudit(
        {
          action: "Product Updated",
          tableName: "products",
          recordId: productId,
          detail: `Product ${existing.name} (${existing.sku}) updated to ${payload.name.trim()} (${targetSku})`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );

      return updatedRows[0] ?? existing;
    });

    return jsonOk({ product: updatedProduct });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ER_DUP_ENTRY") {
      return jsonError("SKU already exists", 409);
    }

    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "products", "delete");

    const resolvedParams = await params;
    const productId = parseProductId(resolvedParams.productId);

    const deletedProduct = await withTransaction(async (conn) => {
      const [rows] = await conn.query<ProductRow[]>(
        `SELECT
           id,
           name,
           category,
           sku,
           unit,
           buy_price,
           sell_price,
           stock,
           min_stock,
           supplier,
           expiry_date,
           is_active,
           created_at,
           updated_at
         FROM products
         WHERE id = ? AND is_active = 1
         LIMIT 1
         FOR UPDATE`,
        [productId],
      );

      const existing = rows[0];
      if (!existing) {
        throw new ApiError(404, "Product not found");
      }

      await conn.execute(
        `UPDATE products
         SET is_active = 0, updated_at = NOW()
         WHERE id = ?`,
        [productId],
      );

      await logAudit(
        {
          action: "Product Deleted",
          tableName: "products",
          recordId: productId,
          detail: `Product ${existing.name} (${existing.sku}) marked inactive`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );

      return existing;
    });

    return jsonOk({ product: deletedProduct });
  } catch (error) {
    return handleApiError(error);
  }
}
