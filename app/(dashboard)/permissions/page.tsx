"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type ModuleKey =
  | "dashboard"
  | "products"
  | "customers"
  | "sales"
  | "reports"
  | "expenses"
  | "audit"
  | "stock"
  | "permissions";

type PermissionItem = {
  module_key: ModuleKey;
  can_view: boolean;
  can_add: boolean;
  can_edit: boolean;
  can_delete: boolean;
};

type ModuleActionSupport = {
  can_view: boolean;
  can_add: boolean;
  can_edit: boolean;
  can_delete: boolean;
};

type ActionField = "can_view" | "can_add" | "can_edit" | "can_delete";

type ActionSupportMap = Record<ModuleKey, ModuleActionSupport>;

type PermissionsResponse = {
  role: "staff";
  modules: ModuleKey[];
  action_support: ActionSupportMap;
  permissions: PermissionItem[];
};

type ApiSuccess<T> = {
  success: true;
  data: T;
};

type ApiErrorPayload = {
  success: false;
  message?: string;
};

const moduleLabelMap: Record<ModuleKey, string> = {
  dashboard: "Dashboard",
  products: "Products",
  customers: "Customers",
  sales: "Sales",
  reports: "Reports",
  expenses: "Expenses",
  audit: "Audit Logs",
  stock: "Stock",
  permissions: "Permissions",
};

const defaultActionSupport: ActionSupportMap = {
  dashboard: { can_view: true, can_add: false, can_edit: false, can_delete: false },
  products: { can_view: true, can_add: true, can_edit: false, can_delete: false },
  customers: { can_view: true, can_add: false, can_edit: true, can_delete: false },
  sales: { can_view: true, can_add: true, can_edit: true, can_delete: false },
  reports: { can_view: true, can_add: false, can_edit: false, can_delete: false },
  expenses: { can_view: true, can_add: true, can_edit: false, can_delete: true },
  audit: { can_view: true, can_add: false, can_edit: false, can_delete: false },
  stock: { can_view: true, can_add: false, can_edit: true, can_delete: false },
  permissions: { can_view: false, can_add: false, can_edit: false, can_delete: false },
};

async function fetchPermissions() {
  const res = await fetch("/api/permissions", {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<PermissionsResponse> | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load permissions");
  }

  return payload.data;
}

function sortPermissions(permissions: PermissionItem[]) {
  const sortOrder: ModuleKey[] = [
    "dashboard",
    "products",
    "customers",
    "sales",
    "reports",
    "expenses",
    "audit",
    "stock",
    "permissions",
  ];

  const orderMap = new Map(sortOrder.map((key, index) => [key, index]));

  return [...permissions].sort(
    (a, b) => (orderMap.get(a.module_key) ?? 999) - (orderMap.get(b.module_key) ?? 999),
  );
}

export default function PermissionsPage() {
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["permissions-matrix"],
    queryFn: fetchPermissions,
  });

  const originalPermissions = useMemo(
    () => sortPermissions(data?.permissions ?? []),
    [data],
  );

  const actionSupport = data?.action_support ?? defaultActionSupport;

  function isActionSupported(moduleKey: ModuleKey, field: ActionField) {
    return actionSupport[moduleKey]?.[field] ?? false;
  }

  function hasAnyActionSupport(field: ActionField) {
    return Object.values(actionSupport).some((item) => item[field]);
  }

  const [draftPermissions, setDraftPermissions] = useState<PermissionItem[] | null>(null);
  const permissions = draftPermissions ?? originalPermissions;

  const hasChanges = useMemo(
    () =>
      draftPermissions !== null
      && JSON.stringify(draftPermissions) !== JSON.stringify(originalPermissions),
    [draftPermissions, originalPermissions],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/permissions", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ permissions }),
      });

      const payload = (await res.json()) as ApiSuccess<PermissionsResponse> | ApiErrorPayload;

      if (!res.ok || !payload.success) {
        throw new Error((payload as ApiErrorPayload).message ?? "Failed to save permissions");
      }

      return payload.data;
    },
    onSuccess: async (updatedData) => {
      toast.success("Permissions updated");
      queryClient.setQueryData(["permissions-matrix"], updatedData);
      setDraftPermissions(null);
      await queryClient.invalidateQueries({ queryKey: ["permissions-matrix"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function setField(moduleKey: ModuleKey, field: ActionField, value: boolean) {
    setDraftPermissions((prev) => {
      const source = prev ?? originalPermissions;

      return source.map((item) => {
        if (item.module_key !== moduleKey) {
          return item;
        }

        if (!isActionSupported(moduleKey, field)) {
          return {
            ...item,
            [field]: false,
          };
        }

        if (field === "can_view") {
          if (!value) {
            return {
              ...item,
              can_view: false,
              can_add: false,
              can_edit: false,
              can_delete: false,
            };
          }

          return {
            ...item,
            can_view: true,
          };
        }

        if (value) {
          return {
            ...item,
            can_view: isActionSupported(moduleKey, "can_view") ? true : false,
            [field]: true,
          };
        }

        return {
          ...item,
          [field]: false,
        };
      });
    });
  }

  function setColumn(field: ActionField, value: boolean) {
    setDraftPermissions((prev) => {
      const source = prev ?? originalPermissions;

      return source.map((item) => {
        if (!isActionSupported(item.module_key, field)) {
          return {
            ...item,
            [field]: false,
          };
        }

        if (field === "can_view") {
          if (!value) {
            return {
              ...item,
              can_view: false,
              can_add: false,
              can_edit: false,
              can_delete: false,
            };
          }

          return {
            ...item,
            can_view: true,
          };
        }

        if (value) {
          return {
            ...item,
            can_view: isActionSupported(item.module_key, "can_view") ? true : false,
            [field]: true,
          };
        }

        return {
          ...item,
          [field]: false,
        };
      });
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Permission Management</h2>
        <p className="text-sm text-slate-500">Configure staff view/add/edit/delete access for each module</p>
      </div>

      <Card className="p-4 text-sm text-slate-700">
        <p>
          Only admin can access this screen. Changes are applied to the <span className="font-semibold">staff</span> role.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Customers module <span className="font-semibold">Edit</span> permission controls CRM customer update and due collection actions.
        </p>
      </Card>

      {isLoading ? <Card className="p-5 text-sm text-slate-500">Loading permission matrix...</Card> : null}

      {isError ? (
        <Card className="p-5 text-sm text-red-600">
          Failed to load permissions. You may not have admin access.
        </Card>
      ) : null}

      {!isLoading && !isError ? (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Staff Permissions Matrix</h3>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setColumn("can_view", true)}
                disabled={!hasAnyActionSupport("can_view")}
              >
                Grant All View
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setColumn("can_add", true)}
                disabled={!hasAnyActionSupport("can_add")}
              >
                Grant All Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setColumn("can_edit", true)}
                disabled={!hasAnyActionSupport("can_edit")}
              >
                Grant All Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setColumn("can_delete", true)}
                disabled={!hasAnyActionSupport("can_delete")}
              >
                Grant All Delete
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setDraftPermissions(null)}
                disabled={!hasChanges || saveMutation.isPending}
              >
                Reset
              </Button>
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={!hasChanges || saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Module</th>
                  <th className="px-4 py-2 text-center">View</th>
                  <th className="px-4 py-2 text-center">Add</th>
                  <th className="px-4 py-2 text-center">Edit</th>
                  <th className="px-4 py-2 text-center">Delete</th>
                </tr>
              </thead>
              <tbody>
                {permissions.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={5}>
                      No permission records found
                    </td>
                  </tr>
                ) : (
                  permissions.map((item) => (
                    <tr key={item.module_key} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-medium text-slate-900">
                        {moduleLabelMap[item.module_key] ?? item.module_key}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {isActionSupported(item.module_key, "can_view") ? (
                          <input
                            type="checkbox"
                            checked={item.can_view}
                            onChange={(event) => setField(item.module_key, "can_view", event.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600"
                          />
                        ) : (
                          <span className="text-xs text-slate-400">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {isActionSupported(item.module_key, "can_add") ? (
                          <input
                            type="checkbox"
                            checked={item.can_add}
                            onChange={(event) => setField(item.module_key, "can_add", event.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600"
                          />
                        ) : (
                          <span className="text-xs text-slate-400">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {isActionSupported(item.module_key, "can_edit") ? (
                          <input
                            type="checkbox"
                            checked={item.can_edit}
                            onChange={(event) => setField(item.module_key, "can_edit", event.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600"
                          />
                        ) : (
                          <span className="text-xs text-slate-400">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {isActionSupported(item.module_key, "can_delete") ? (
                          <input
                            type="checkbox"
                            checked={item.can_delete}
                            onChange={(event) => setField(item.module_key, "can_delete", event.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600"
                          />
                        ) : (
                          <span className="text-xs text-slate-400">N/A</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
