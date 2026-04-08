import type { RowDataPacket } from "mysql2/promise";
import {
  type ModuleKey,
  type PermissionAction,
} from "@/lib/server/constants";
import { dbQuery } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import type { SessionUser } from "@/lib/server/require-user";

interface PermissionRow extends RowDataPacket {
  can_view: number;
  can_add: number;
  can_delete: number;
}

export async function assertPermission(
  user: SessionUser,
  moduleKey: ModuleKey,
  action: PermissionAction,
) {
  if (user.role === "admin") {
    return;
  }

  const rows = await dbQuery<PermissionRow[]>(
    `SELECT can_view, can_add, can_delete
     FROM role_permissions
     WHERE role = 'staff' AND module_key = ?
     LIMIT 1`,
    [moduleKey],
  );

  const row = rows[0];

  const allowed =
    action === "view"
      ? row?.can_view === 1
      : action === "add"
        ? row?.can_add === 1
        : row?.can_delete === 1;

  if (!allowed) {
    throw new ApiError(403, `Permission denied for ${moduleKey}:${action}`);
  }
}
