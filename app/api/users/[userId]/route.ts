import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { logAudit } from "@/lib/server/audit";
import { withTransaction } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

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

const updateStaffStatusSchema = z.object({
  is_active: z.boolean(),
});

const updateStaffProfileSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(191),
  phone: z.string().max(30).optional().nullable(),
});

function cleanText(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

function parseUserId(value: string) {
  const userId = decodeURIComponent(value).trim();

  if (!/^[0-9a-fA-F-]{36}$/.test(userId)) {
    throw new ApiError(400, "Invalid user id");
  }

  return userId;
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "users", "edit");

    const resolvedParams = await params;
    const userId = parseUserId(resolvedParams.userId);

    const body = await request.json().catch(() => {
      throw new ApiError(400, "Invalid JSON body");
    });

    const parsed = updateStaffStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid user status payload");
    }

    const targetActive = parsed.data.is_active;

    const updatedUser = await withTransaction(async (conn) => {
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
         LIMIT 1
         FOR UPDATE`,
        [userId],
      );

      const row = rows[0];
      if (!row) {
        throw new ApiError(404, "Staff user not found");
      }

      await conn.execute(
        `UPDATE users
         SET is_active = ?, updated_at = NOW()
         WHERE id = ?`,
        [targetActive ? 1 : 0, row.id],
      );

      const [updatedRows] = await conn.query<StaffUserRow[]>(
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
        [row.id],
      );

      await logAudit(
        {
          action: targetActive ? "Staff User Activated" : "Staff User Deactivated",
          tableName: "users",
          recordId: row.id,
          detail: `Staff user ${row.email} set to ${targetActive ? "active" : "inactive"}`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );

      return updatedRows[0] ?? row;
    });

    return jsonOk({ user: serializeUser(updatedUser) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "users", "edit");

    const resolvedParams = await params;
    const userId = parseUserId(resolvedParams.userId);

    const body = await request.json().catch(() => {
      throw new ApiError(400, "Invalid JSON body");
    });

    const parsed = updateStaffProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid staff user payload");
    }

    const payload = parsed.data;
    const nextEmail = payload.email.trim().toLowerCase();

    const updatedUser = await withTransaction(async (conn) => {
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
         LIMIT 1
         FOR UPDATE`,
        [userId],
      );

      const row = rows[0];
      if (!row) {
        throw new ApiError(404, "Staff user not found");
      }

      await conn.execute(
        `UPDATE users
         SET name = ?, email = ?, phone = ?, updated_at = NOW()
         WHERE id = ?`,
        [payload.name.trim(), nextEmail, cleanText(payload.phone), row.id],
      );

      const [updatedRows] = await conn.query<StaffUserRow[]>(
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
        [row.id],
      );

      await logAudit(
        {
          action: "Staff User Updated",
          tableName: "users",
          recordId: row.id,
          detail: `Staff user ${row.email} updated to ${nextEmail}`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );

      return updatedRows[0] ?? row;
    });

    return jsonOk({ user: serializeUser(updatedUser) });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ER_DUP_ENTRY") {
      return handleApiError(new ApiError(409, "Email already exists"));
    }

    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "users", "delete");

    const resolvedParams = await params;
    const userId = parseUserId(resolvedParams.userId);

    const deletedUser = await withTransaction(async (conn) => {
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
         LIMIT 1
         FOR UPDATE`,
        [userId],
      );

      const row = rows[0];
      if (!row) {
        throw new ApiError(404, "Staff user not found");
      }

      await conn.execute(
        `DELETE FROM users
         WHERE id = ? AND role = 'staff'
         LIMIT 1`,
        [row.id],
      );

      await logAudit(
        {
          action: "Staff User Deleted",
          tableName: "users",
          recordId: row.id,
          detail: `Staff user ${row.email} deleted`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );

      return row;
    });

    return jsonOk({ user: serializeUser(deletedUser) });
  } catch (error) {
    if (
      typeof error === "object"
      && error
      && "code" in error
      && (error.code === "ER_ROW_IS_REFERENCED_2" || error.code === "ER_ROW_IS_REFERENCED")
    ) {
      return handleApiError(new ApiError(409, "Cannot delete this staff user because related records exist"));
    }

    return handleApiError(error);
  }
}
