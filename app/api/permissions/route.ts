import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { logAudit } from "@/lib/server/audit";
import { MODULE_KEYS, type ModuleKey } from "@/lib/server/constants";
import { dbQuery, withTransaction } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { requireUserFromRequest, type SessionUser } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

interface PermissionRow extends RowDataPacket {
  module_key: ModuleKey;
  can_view: number;
  can_add: number;
  can_delete: number;
}

const permissionItemSchema = z.object({
  module_key: z.enum(MODULE_KEYS),
  can_view: z.boolean(),
  can_add: z.boolean(),
  can_delete: z.boolean(),
});

const updatePermissionsSchema = z.object({
  permissions: z.array(permissionItemSchema).min(1).max(MODULE_KEYS.length),
});

function assertAdmin(user: SessionUser) {
  if (user.role !== "admin") {
    throw new ApiError(403, "Only admin can manage module permissions");
  }
}

async function getStaffPermissionMatrix() {
  const rows = await dbQuery<PermissionRow[]>(
    `SELECT module_key, can_view, can_add, can_delete
     FROM role_permissions
     WHERE role = 'staff'`,
  );

  const rowMap = new Map(rows.map((row) => [row.module_key, row]));

  return MODULE_KEYS.map((moduleKey) => {
    const row = rowMap.get(moduleKey);

    return {
      module_key: moduleKey,
      can_view: row?.can_view === 1,
      can_add: row?.can_add === 1,
      can_delete: row?.can_delete === 1,
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    assertAdmin(user);

    const permissions = await getStaffPermissionMatrix();

    return jsonOk({
      role: "staff",
      modules: MODULE_KEYS,
      permissions,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    assertAdmin(user);

    const body = await request.json().catch(() => {
      throw new ApiError(400, "Invalid JSON body");
    });

    const parsed = updatePermissionsSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid permissions payload");
    }

    const duplicateCheck = new Set<string>();
    for (const item of parsed.data.permissions) {
      if (duplicateCheck.has(item.module_key)) {
        throw new ApiError(422, `Duplicate module permission: ${item.module_key}`);
      }

      duplicateCheck.add(item.module_key);
    }

    const normalized = parsed.data.permissions.map((item) => {
      const canView = item.can_view || item.can_add || item.can_delete;

      return {
        module_key: item.module_key,
        can_view: canView,
        can_add: canView ? item.can_add : false,
        can_delete: canView ? item.can_delete : false,
      };
    });

    await withTransaction(async (conn) => {
      for (const item of normalized) {
        await conn.execute(
          `INSERT INTO role_permissions (role, module_key, can_view, can_add, can_delete)
           VALUES ('staff', ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             can_view = VALUES(can_view),
             can_add = VALUES(can_add),
             can_delete = VALUES(can_delete)`,
          [
            item.module_key,
            item.can_view ? 1 : 0,
            item.can_add ? 1 : 0,
            item.can_delete ? 1 : 0,
          ],
        );
      }

      await logAudit(
        {
          action: "Permissions Updated",
          tableName: "role_permissions",
          recordId: "staff",
          detail: `Staff permissions updated for ${normalized.length} modules`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );
    });

    const permissions = await getStaffPermissionMatrix();

    return jsonOk({
      role: "staff",
      modules: MODULE_KEYS,
      permissions,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
