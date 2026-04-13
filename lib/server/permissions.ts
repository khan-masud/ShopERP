import type { RowDataPacket } from "mysql2/promise";
import {
  MODULE_KEYS,
  MODULE_ACTION_SUPPORT,
  type ModuleKey,
  type PermissionAction,
} from "@/lib/server/constants";
import { dbQuery } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import type { SessionUser } from "@/lib/server/require-user";

interface PermissionRow extends RowDataPacket {
  module_key: ModuleKey;
  can_view: number;
  can_add: number;
  can_edit: number;
  can_delete: number;
}

export type PermissionFlags = {
  can_view: boolean;
  can_add: boolean;
  can_edit: boolean;
  can_delete: boolean;
};

export type UserPermissionMap = Record<ModuleKey, PermissionFlags>;

function isActionSupported(moduleKey: ModuleKey, action: PermissionAction) {
  const support = MODULE_ACTION_SUPPORT[moduleKey];

  if (action === "view") {
    return support.can_view;
  }

  if (action === "add") {
    return support.can_add;
  }

  if (action === "edit") {
    return support.can_edit;
  }

  return support.can_delete;
}

function buildFullAccessMap(): UserPermissionMap {
  return MODULE_KEYS.reduce<UserPermissionMap>((acc, moduleKey) => {
    acc[moduleKey] = {
      can_view: true,
      can_add: true,
      can_edit: true,
      can_delete: true,
    };

    return acc;
  }, {} as UserPermissionMap);
}

function buildNoAccessMap(): UserPermissionMap {
  return MODULE_KEYS.reduce<UserPermissionMap>((acc, moduleKey) => {
    acc[moduleKey] = {
      can_view: false,
      can_add: false,
      can_edit: false,
      can_delete: false,
    };

    return acc;
  }, {} as UserPermissionMap);
}

export async function getUserPermissionMap(user: SessionUser): Promise<UserPermissionMap> {
  if (user.role === "admin") {
    return buildFullAccessMap();
  }

  const rows = await dbQuery<PermissionRow[]>(
    `SELECT module_key, can_view, can_add, can_edit, can_delete
     FROM role_permissions
     WHERE role = 'staff'`,
  );

  const permissions = buildNoAccessMap();

  for (const row of rows) {
    const moduleSupport = MODULE_ACTION_SUPPORT[row.module_key];
    const canView = moduleSupport.can_view && row.can_view === 1;

    permissions[row.module_key] = {
      can_view: canView,
      can_add: canView && moduleSupport.can_add && row.can_add === 1,
      can_edit: canView && moduleSupport.can_edit && row.can_edit === 1,
      can_delete: canView && moduleSupport.can_delete && row.can_delete === 1,
    };
  }

  return permissions;
}

export async function assertPermission(
  user: SessionUser,
  moduleKey: ModuleKey,
  action: PermissionAction,
) {
  if (user.role === "admin") {
    return;
  }

  if (!isActionSupported(moduleKey, action)) {
    throw new ApiError(403, `Permission denied for ${moduleKey}:${action}`);
  }

  const rows = await dbQuery<PermissionRow[]>(
    `SELECT module_key, can_view, can_add, can_edit, can_delete
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
        : action === "edit"
          ? row?.can_edit === 1
          : row?.can_delete === 1;

  if (!allowed) {
    throw new ApiError(403, `Permission denied for ${moduleKey}:${action}`);
  }
}
