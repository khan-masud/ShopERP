export const ACCESS_COOKIE_NAME = "shoperp_access";
export const REFRESH_COOKIE_NAME = "shoperp_refresh";

export const MODULE_KEYS = [
  "dashboard",
  "products",
  "customers",
  "sales",
  "reports",
  "expenses",
  "audit",
  "stock",
  "permissions",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];
export type PermissionAction = "view" | "add" | "edit" | "delete";
export type UserRole = "admin" | "staff";

export type ModuleActionSupport = {
  can_view: boolean;
  can_add: boolean;
  can_edit: boolean;
  can_delete: boolean;
};

export const MODULE_ACTION_SUPPORT: Record<ModuleKey, ModuleActionSupport> = {
  dashboard: {
    can_view: true,
    can_add: false,
    can_edit: false,
    can_delete: false,
  },
  products: {
    can_view: true,
    can_add: true,
    can_edit: true,
    can_delete: true,
  },
  customers: {
    can_view: true,
    can_add: false,
    can_edit: true,
    can_delete: false,
  },
  sales: {
    can_view: true,
    can_add: true,
    can_edit: true,
    can_delete: false,
  },
  reports: {
    can_view: true,
    can_add: false,
    can_edit: false,
    can_delete: false,
  },
  expenses: {
    can_view: true,
    can_add: true,
    can_edit: true,
    can_delete: true,
  },
  audit: {
    can_view: true,
    can_add: false,
    can_edit: false,
    can_delete: false,
  },
  stock: {
    can_view: true,
    can_add: false,
    can_edit: true,
    can_delete: false,
  },
  permissions: {
    can_view: false,
    can_add: false,
    can_edit: false,
    can_delete: false,
  },
};
