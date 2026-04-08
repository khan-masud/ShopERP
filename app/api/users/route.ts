import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { hashPassword } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { dbQuery, withTransaction } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { requireUserFromRequest, type SessionUser } from "@/lib/server/require-user";
import { handleApiError, jsonError, jsonOk } from "@/lib/server/response";

type QueryParam = string | number | boolean | Date | null;

interface StaffUserRow extends RowDataPacket {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "staff";
  is_active: number;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface CountRow extends RowDataPacket {
  total_count: number;
}

const createStaffUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(191),
  phone: z.string().max(30).optional().nullable(),
  password: z.string().min(8).max(100),
});

function assertAdmin(user: SessionUser) {
  if (user.role !== "admin") {
    throw new ApiError(403, "Only admin can manage staff users");
  }
}

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

function cleanText(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

function serializeUser(row: StaffUserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    is_active: row.is_active === 1,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    assertAdmin(user);

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() ?? "";
    const includeInactive = searchParams.get("includeInactive") === "1";
    const page = parsePositiveInt(searchParams.get("page"), 1, 1000000);
    const pageSize = parsePositiveInt(
      searchParams.get("pageSize") ?? searchParams.get("limit"),
      25,
      200,
    );
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ["u.role = 'staff'"];
    const values: QueryParam[] = [];

    if (!includeInactive) {
      conditions.push("u.is_active = 1");
    }

    if (query) {
      conditions.push("(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)");
      values.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const [users, countRows] = await Promise.all([
      dbQuery<StaffUserRow[]>(
        `SELECT
           u.id,
           u.name,
           u.email,
           u.phone,
           u.role,
           u.is_active,
           u.last_login_at,
           u.created_at,
           u.updated_at
         FROM users u
         ${where}
         ORDER BY u.created_at DESC
         LIMIT ?
         OFFSET ?`,
        [...values, pageSize, offset],
      ),
      dbQuery<CountRow[]>(
        `SELECT COUNT(*) AS total_count
         FROM users u
         ${where}`,
        values,
      ),
    ]);

    const totalCount = Number(countRows[0]?.total_count ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    return jsonOk({
      users: users.map(serializeUser),
      pagination: {
        page,
        page_size: pageSize,
        total_count: totalCount,
        total_pages: totalPages,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    assertAdmin(user);

    const body = await request.json().catch(() => {
      throw new ApiError(400, "Invalid JSON body");
    });

    const parsed = createStaffUserSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid staff user payload");
    }

    const payload = parsed.data;
    const staffId = randomUUID();
    const email = payload.email.trim().toLowerCase();
    const passwordHash = await hashPassword(payload.password);

    const createdUser = await withTransaction(async (conn) => {
      await conn.execute(
        `INSERT INTO users (
          id, name, email, phone, password_hash, role, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'staff', 1, NOW(), NOW())`,
        [
          staffId,
          payload.name.trim(),
          email,
          cleanText(payload.phone),
          passwordHash,
        ],
      );

      const [rows] = await conn.query<StaffUserRow[]>(
        `SELECT
           u.id,
           u.name,
           u.email,
           u.phone,
           u.role,
           u.is_active,
           u.last_login_at,
           u.created_at,
           u.updated_at
         FROM users u
         WHERE u.id = ? AND u.role = 'staff'
         LIMIT 1`,
        [staffId],
      );

      await logAudit(
        {
          action: "Staff User Created",
          tableName: "users",
          recordId: staffId,
          detail: `Staff user ${email} created`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );

      return rows[0] ?? null;
    });

    return jsonOk({ user: createdUser ? serializeUser(createdUser) : null }, 201);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ER_DUP_ENTRY") {
      return jsonError("Email already exists", 409);
    }

    return handleApiError(error);
  }
}
