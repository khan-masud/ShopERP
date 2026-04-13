import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { logAudit } from "@/lib/server/audit";
import { dbQuery, withTransaction } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

type QueryParam = string | number | boolean | Date | null;
type StockStatusFilter = "all" | "low_stock" | "out_of_stock";

interface StockProductRow extends RowDataPacket {
  id: string;
  name: string;
  sku: string;
  category: string;
  stock: number;
  min_stock: number;
  buy_price: string;
  sell_price: string;
}

interface StockHistoryRow extends RowDataPacket {
  id: string;
  product_id: string;
  product_name: string;
  change_type: "restock" | "sale" | "adjustment";
  quantity_change: number;
  quantity_before: number;
  quantity_after: number;
  note: string | null;
  created_at: Date;
  created_by_name: string | null;
}

interface StockSummaryRow extends RowDataPacket {
  total_products: number;
  low_stock_count: number;
  out_of_stock_count: number;
  total_stock: number;
}

interface CountRow extends RowDataPacket {
  total_count: number;
}

interface ProductForAdjustRow extends RowDataPacket {
  id: string;
  name: string;
  stock: number;
  min_stock: number;
  is_active: number;
}

const stockAdjustSchema = z.object({
  product_id: z.string().min(10).max(36),
  change_type: z.enum(["restock", "adjustment"]),
  quantity_change: z.number().int().refine((value) => value !== 0, "Quantity change cannot be zero"),
  note: z.string().max(255).optional().nullable(),
});

function cleanText(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

function parseStockStatus(value: string | null, lowOnly: boolean): StockStatusFilter {
  if (value === "low_stock") {
    return "low_stock";
  }

  if (value === "out_of_stock") {
    return "out_of_stock";
  }

  if (lowOnly) {
    return "low_stock";
  }

  return "all";
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "stock", "view");

    const { searchParams } = new URL(request.url);

    const query = searchParams.get("q")?.trim() ?? "";
    const lowOnly = searchParams.get("lowOnly") === "1";
    const stockStatus = parseStockStatus(searchParams.get("stockStatus"), lowOnly);
    const productId = searchParams.get("productId")?.trim() ?? "";

    if (productId && !/^[0-9a-fA-F-]{36}$/.test(productId)) {
      throw new ApiError(400, "Invalid product id");
    }

    const productPage = parsePositiveInt(searchParams.get("page"), 1, 1000000);
    const productPageSize = parsePositiveInt(
      searchParams.get("pageSize") ?? searchParams.get("limit"),
      50,
      200,
    );
    const productOffset = (productPage - 1) * productPageSize;

    const historyPage = parsePositiveInt(searchParams.get("historyPage"), 1, 1000000);
    const historyPageSize = parsePositiveInt(
      searchParams.get("historyPageSize") ?? searchParams.get("historyLimit"),
      20,
      200,
    );
    const historyOffset = (historyPage - 1) * historyPageSize;

    const conditions: string[] = ["p.is_active = 1"];
    const values: QueryParam[] = [];

    if (query) {
      conditions.push("(p.name LIKE ? OR p.sku LIKE ?)");
      values.push(`%${query}%`, `%${query}%`);
    }

    if (stockStatus === "low_stock") {
      conditions.push("p.stock > 0 AND p.stock <= p.min_stock");
    } else if (stockStatus === "out_of_stock") {
      conditions.push("p.stock <= 0");
    }

    if (productId) {
      conditions.push("p.id = ?");
      values.push(productId);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const historyConditions: string[] = [];
    const historyValues: QueryParam[] = [];

    if (query) {
      historyConditions.push("(h.product_name LIKE ? OR h.note LIKE ?)");
      historyValues.push(`%${query}%`, `%${query}%`);
    }

    if (productId) {
      historyConditions.push("h.product_id = ?");
      historyValues.push(productId);
    }

    const historyWhere = historyConditions.length ? `WHERE ${historyConditions.join(" AND ")}` : "";

    const [products, productCountRows, history, historyCountRows, summaryRows] = await Promise.all([
      dbQuery<StockProductRow[]>(
        `SELECT
           p.id,
           p.name,
           p.sku,
           p.category,
           p.stock,
           p.min_stock,
           p.buy_price,
           p.sell_price
         FROM products p
         ${where}
         ORDER BY (p.stock <= p.min_stock) DESC, p.updated_at DESC
         LIMIT ?
         OFFSET ?`,
        [...values, productPageSize, productOffset],
      ),
      dbQuery<CountRow[]>(
        `SELECT COUNT(*) AS total_count
         FROM products p
         ${where}`,
        values,
      ),
      dbQuery<StockHistoryRow[]>(
        `SELECT
           h.id,
           h.product_id,
           h.product_name,
           h.change_type,
           h.quantity_change,
           h.quantity_before,
           h.quantity_after,
           h.note,
           h.created_at,
           u.name AS created_by_name
         FROM stock_history h
         LEFT JOIN users u ON u.id = h.created_by
         ${historyWhere}
         ORDER BY h.created_at DESC
         LIMIT ?
         OFFSET ?`,
        [...historyValues, historyPageSize, historyOffset],
      ),
      dbQuery<CountRow[]>(
        `SELECT COUNT(*) AS total_count
         FROM stock_history h
         ${historyWhere}`,
        historyValues,
      ),
      dbQuery<StockSummaryRow[]>(
        `SELECT
           COUNT(*) AS total_products,
           COALESCE(SUM(CASE WHEN stock > 0 AND stock <= min_stock THEN 1 ELSE 0 END), 0) AS low_stock_count,
           COALESCE(SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END), 0) AS out_of_stock_count,
           COALESCE(SUM(stock), 0) AS total_stock
         FROM products
         WHERE is_active = 1`,
      ),
    ]);

    const productsTotalCount = Number(productCountRows[0]?.total_count ?? 0);
    const productsTotalPages = Math.max(1, Math.ceil(productsTotalCount / productPageSize));
    const historyTotalCount = Number(historyCountRows[0]?.total_count ?? 0);
    const historyTotalPages = Math.max(1, Math.ceil(historyTotalCount / historyPageSize));

    return jsonOk({
      products,
      products_pagination: {
        page: productPage,
        page_size: productPageSize,
        total_count: productsTotalCount,
        total_pages: productsTotalPages,
      },
      history,
      history_pagination: {
        page: historyPage,
        page_size: historyPageSize,
        total_count: historyTotalCount,
        total_pages: historyTotalPages,
      },
      summary: {
        total_products: Number(summaryRows[0]?.total_products ?? 0),
        low_stock_count: Number(summaryRows[0]?.low_stock_count ?? 0),
        out_of_stock_count: Number(summaryRows[0]?.out_of_stock_count ?? 0),
        total_stock: Number(summaryRows[0]?.total_stock ?? 0),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "stock", "edit");

    const body = await request.json().catch(() => {
      throw new ApiError(400, "Invalid JSON body");
    });

    const parsed = stockAdjustSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid stock adjustment payload");
    }

    const payload = parsed.data;

    if (payload.change_type === "restock" && payload.quantity_change < 0) {
      throw new ApiError(422, "Restock quantity must be a positive number");
    }

    const historyId = randomUUID();

    const result = await withTransaction(async (conn) => {
      const [productRows] = await conn.query<ProductForAdjustRow[]>(
        `SELECT id, name, stock, min_stock, is_active
         FROM products
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [payload.product_id],
      );

      const product = productRows[0];
      if (!product || product.is_active !== 1) {
        throw new ApiError(404, "Product not found");
      }

      const before = Number(product.stock ?? 0);
      const after = before + payload.quantity_change;

      if (after < 0) {
        throw new ApiError(400, "Stock adjustment would make inventory negative");
      }

      await conn.execute(
        `UPDATE products
         SET stock = ?, updated_at = NOW()
         WHERE id = ?`,
        [after, product.id],
      );

      await conn.execute(
        `INSERT INTO stock_history (
          id, product_id, product_name, change_type,
          quantity_change, quantity_before, quantity_after,
          note, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          historyId,
          product.id,
          product.name,
          payload.change_type,
          payload.quantity_change,
          before,
          after,
          cleanText(payload.note),
          user.id,
        ],
      );

      await logAudit(
        {
          action: "Stock Adjusted",
          tableName: "stock_history",
          recordId: historyId,
          detail: `Stock ${payload.change_type} on ${product.name}: ${before} -> ${after} (delta ${payload.quantity_change})`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );

      return {
        history_id: historyId,
        product_id: product.id,
        product_name: product.name,
        quantity_before: before,
        quantity_after: after,
        quantity_change: payload.quantity_change,
        low_stock: after <= product.min_stock,
      };
    });

    return jsonOk(result, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
