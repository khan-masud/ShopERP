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
export type PermissionAction = "view" | "add" | "delete";
export type UserRole = "admin" | "staff";
