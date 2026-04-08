import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { logAudit } from "@/lib/server/audit";
import { dbExecute, dbQuery } from "@/lib/server/db";
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

const createProductSchema = z.object({
  name: z.string().min(2).max(191),
  category: z.enum(categories),
  sku: z.string().max(100).optional(),
  unit: z.string().max(30).default("pcs"),
  buy_price: z.number().nonnegative(),
  sell_price: z.number().positive(),
  stock: z.number().int().nonnegative().default(0),
  min_stock: z.number().int().nonnegative().default(10),
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

interface ProductSummaryRow extends RowDataPacket {
  total_count: number;
  low_stock_count: number;
}

type QueryParam = string | number | boolean | Date | null;

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

function generateSku(name: string) {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6)
    .padEnd(3, "X");
  const suffix = Date.now().toString().slice(-6);
  return `${base}-${suffix}`;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "products", "view");

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim();
    const category = searchParams.get("category")?.trim();
    const includeInactive = searchParams.get("includeInactive") === "1";
    const page = parsePositiveInt(searchParams.get("page"), 1, 1000000);
    const pageSize = parsePositiveInt(
      searchParams.get("pageSize") ?? searchParams.get("limit"),
      25,
      200,
    );
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const values: QueryParam[] = [];

    if (!includeInactive) {
      conditions.push("p.is_active = 1");
    }

    if (query) {
      conditions.push("(p.name LIKE ? OR p.sku LIKE ?)");
      values.push(`%${query}%`, `%${query}%`);
    }

    if (category && categories.includes(category as (typeof categories)[number])) {
      conditions.push("p.category = ?");
      values.push(category);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [products, summaryRows] = await Promise.all([
      dbQuery<ProductRow[]>(
        `SELECT
           p.id,
           p.name,
           p.category,
           p.sku,
           p.unit,
           p.buy_price,
           p.sell_price,
           p.stock,
           p.min_stock,
           p.supplier,
           p.expiry_date,
           p.is_active,
           p.created_at,
           p.updated_at
         FROM products p
         ${where}
         ORDER BY p.updated_at DESC
         LIMIT ?
         OFFSET ?`,
        [...values, pageSize, offset],
      ),
      dbQuery<ProductSummaryRow[]>(
        `SELECT
           COUNT(*) AS total_count,
           COALESCE(SUM(CASE WHEN p.stock <= p.min_stock THEN 1 ELSE 0 END), 0) AS low_stock_count
         FROM products p
         ${where}`,
        values,
      ),
    ]);

    const totalCount = Number(summaryRows[0]?.total_count ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    return jsonOk({
      products,
      pagination: {
        page,
        page_size: pageSize,
        total_count: totalCount,
        total_pages: totalPages,
      },
      summary: {
        low_stock_count: Number(summaryRows[0]?.low_stock_count ?? 0),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "products", "add");

    const body = await request.json().catch(() => {
      throw new ApiError(400, "Invalid JSON body");
    });

    const parsed = createProductSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid product payload");
    }

    const payload = parsed.data;
    const sku = payload.sku?.trim().toUpperCase() || generateSku(payload.name);

    await dbExecute(
      `INSERT INTO products (
        id, name, category, sku, unit,
        buy_price, sell_price, stock, min_stock,
        supplier, expiry_date, is_active, created_at, updated_at
      ) VALUES (
        UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW()
      )`,
      [
        payload.name.trim(),
        payload.category,
        sku,
        payload.unit,
        payload.buy_price,
        payload.sell_price,
        payload.stock,
        payload.min_stock,
        payload.supplier?.trim() || null,
        payload.expiry_date || null,
      ],
    );

    const inserted = await dbQuery<ProductRow[]>(
      `SELECT id, name, category, sku, unit, buy_price, sell_price, stock, min_stock,
              supplier, expiry_date, is_active, created_at, updated_at
       FROM products
       WHERE sku = ?
       LIMIT 1`,
      [sku],
    );

    await logAudit(
      {
        action: "Product Added",
        tableName: "products",
        recordId: inserted[0]?.id ?? null,
        detail: `Product ${payload.name.trim()} (${sku}) created`,
        userId: user.id,
        userEmail: user.email,
      },
      request,
    );

    return jsonOk({ product: inserted[0] }, 201);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ER_DUP_ENTRY") {
      return jsonError("SKU already exists", 409);
    }

    return handleApiError(error);
  }
}
