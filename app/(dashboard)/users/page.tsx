"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { formatDateTime } from "@/lib/utils";

type StaffUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "staff";
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

type StaffUsersResponse = {
  users: StaffUser[];
  pagination: {
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
  };
};

type ApiSuccess<T> = {
  success: true;
  data: T;
};

type ApiErrorPayload = {
  success: false;
  message?: string;
};

async function fetchStaffUsers(
  search: string,
  includeInactive: boolean,
  page: number,
  pageSize: number,
) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  if (search.trim()) {
    params.set("q", search.trim());
  }

  if (includeInactive) {
    params.set("includeInactive", "1");
  }

  const res = await fetch(`/api/users?${params.toString()}`, {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<StaffUsersResponse> | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load staff users");
  }

  return payload.data;
}

export default function StaffUsersPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");

  const {
    data,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["staff-users", search, includeInactive, page, pageSize],
    queryFn: () => fetchStaffUsers(search, includeInactive, page, pageSize),
  });

  const users = data?.users ?? [];
  const pagination = data?.pagination ?? {
    page,
    page_size: pageSize,
    total_count: users.length,
    total_pages: 1,
  };

  const showingFrom =
    pagination.total_count === 0 ? 0 : (pagination.page - 1) * pagination.page_size + 1;
  const showingTo =
    pagination.total_count === 0
      ? 0
      : Math.min(pagination.page * pagination.page_size, pagination.total_count);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) {
        throw new Error("Name is required");
      }

      if (!email.trim()) {
        throw new Error("Email is required");
      }

      if (!password || password.length < 8) {
        throw new Error("Password must be at least 8 characters");
      }

      const res = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          password,
        }),
      });

      const payload = (await res.json()) as ApiSuccess<{ user: StaffUser }> | ApiErrorPayload;

      if (!res.ok || !payload.success) {
        throw new Error((payload as ApiErrorPayload).message ?? "Failed to create staff user");
      }
    },
    onSuccess: async () => {
      toast.success("Staff user created");
      setName("");
      setEmail("");
      setPhone("");
      setPassword("");
      setPage(1);
      await queryClient.invalidateQueries({ queryKey: ["staff-users"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async (user: StaffUser) => {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          is_active: !user.is_active,
        }),
      });

      const payload = (await res.json()) as ApiSuccess<{ user: StaffUser }> | ApiErrorPayload;

      if (!res.ok || !payload.success) {
        throw new Error((payload as ApiErrorPayload).message ?? "Failed to update staff status");
      }
    },
    onSuccess: async () => {
      toast.success("Staff user status updated");
      await queryClient.invalidateQueries({ queryKey: ["staff-users"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editingUserId) {
        throw new Error("No staff user selected");
      }

      if (!editName.trim()) {
        throw new Error("Name is required");
      }

      if (!editEmail.trim()) {
        throw new Error("Email is required");
      }

      const res = await fetch(`/api/users/${editingUserId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editName.trim(),
          email: editEmail.trim(),
          phone: editPhone.trim() || null,
        }),
      });

      const payload = (await res.json()) as ApiSuccess<{ user: StaffUser }> | ApiErrorPayload;

      if (!res.ok || !payload.success) {
        throw new Error((payload as ApiErrorPayload).message ?? "Failed to update staff user");
      }
    },
    onSuccess: async () => {
      toast.success("Staff user updated");
      closeEditModal();
      await queryClient.invalidateQueries({ queryKey: ["staff-users"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (staffUser: StaffUser) => {
      const res = await fetch(`/api/users/${staffUser.id}`, {
        method: "DELETE",
      });

      const payload = (await res.json()) as ApiSuccess<{ user: StaffUser }> | ApiErrorPayload;

      if (!res.ok || !payload.success) {
        throw new Error((payload as ApiErrorPayload).message ?? "Failed to delete staff user");
      }
    },
    onSuccess: async () => {
      toast.success("Staff user deleted");
      await queryClient.invalidateQueries({ queryKey: ["staff-users"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function openEditModal(staffUser: StaffUser) {
    setEditingUserId(staffUser.id);
    setEditName(staffUser.name);
    setEditEmail(staffUser.email);
    setEditPhone(staffUser.phone ?? "");
    setIsEditModalOpen(true);
  }

  function closeEditModal() {
    setIsEditModalOpen(false);
    setEditingUserId(null);
    setEditName("");
    setEditEmail("");
    setEditPhone("");
  }

  function confirmDeleteUser(staffUser: StaffUser) {
    const confirmed = window.confirm(
      `Delete staff user \"${staffUser.name}\" (${staffUser.email})? This action cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    deleteMutation.mutate(staffUser);
  }

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-900">Create Staff User</h3>

        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Staff name"
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="staff@domain.com"
          />
          <Input
            label="Phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="Optional"
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Minimum 8 chars"
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-transparent select-none">Action</span>
            <Button className="w-full" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Staff"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Staff Users</h3>
        </div>

        <div className="grid gap-3 border-b border-slate-200 px-4 py-3 md:grid-cols-3">
          <Input
            label="Search"
            placeholder="Search by name/email/phone"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Status Filter</span>
            <span className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(event) => {
                  setIncludeInactive(event.target.checked);
                  setPage(1);
                }}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              Include inactive users
            </span>
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-transparent select-none">Action</span>
            <Button
              variant="secondary"
              className="h-10 w-full"
              onClick={() => {
                setSearch("");
                setIncludeInactive(true);
                setPage(1);
              }}
            >
              Clear Filters
            </Button>
          </div>
        </div>

        {isLoading ? <p className="px-4 py-6 text-sm text-slate-500">Loading staff users...</p> : null}
        {isError ? (
          <p className="px-4 py-6 text-sm text-red-600">Failed to load staff users. Admin access is required.</p>
        ) : null}

        {!isLoading && !isError ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">Phone</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Last Login</th>
                  <th className="px-3 py-2 text-left">Created</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-slate-500" colSpan={7}>
                      No staff users found
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-900">{user.name}</td>
                      <td className="px-3 py-2 text-slate-700">{user.email}</td>
                      <td className="px-3 py-2 text-slate-700">{user.phone || "-"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            user.is_active
                              ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700"
                              : "rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700"
                          }
                        >
                          {user.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {user.last_login_at ? formatDateTime(user.last_login_at) : "Never"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(user.created_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="min-w-20"
                            disabled={
                              toggleStatusMutation.isPending || editMutation.isPending || deleteMutation.isPending
                            }
                            onClick={() => openEditModal(user)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            className="min-w-20"
                            disabled={
                              toggleStatusMutation.isPending || editMutation.isPending || deleteMutation.isPending
                            }
                            onClick={() => confirmDeleteUser(user)}
                          >
                            Delete
                          </Button>
                          <Button
                            size="sm"
                            variant={user.is_active ? "secondary" : "primary"}
                            className="min-w-24"
                            disabled={
                              toggleStatusMutation.isPending || editMutation.isPending || deleteMutation.isPending
                            }
                            onClick={() => toggleStatusMutation.mutate(user)}
                          >
                            {user.is_active ? "Deactivate" : "Activate"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        {!isLoading && !isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-600">
              Showing {showingFrom}-{showingTo} of {pagination.total_count}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <span>Rows</span>
                <select
                  className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                  value={String(pagination.page_size)}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </label>

              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                disabled={pagination.page <= 1}
              >
                Previous
              </Button>

              <span className="min-w-24 text-center text-xs text-slate-600">
                Page {pagination.page} of {pagination.total_pages}
              </span>

              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPage((prev) => Math.min(prev + 1, pagination.total_pages))}
                disabled={pagination.page >= pagination.total_pages}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {isEditModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <Card className="w-full max-w-3xl p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">Edit Staff User</h3>
              <Button variant="ghost" size="sm" onClick={closeEditModal} disabled={editMutation.isPending}>
                Close
              </Button>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Input
                label="Name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="Staff name"
              />
              <Input
                label="Email"
                type="email"
                value={editEmail}
                onChange={(event) => setEditEmail(event.target.value)}
                placeholder="staff@domain.com"
              />
              <Input
                label="Phone"
                value={editPhone}
                onChange={(event) => setEditPhone(event.target.value)}
                placeholder="Optional"
              />
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-transparent select-none">Action</span>
                <div className="flex items-center gap-2">
                  <Button className="w-full" onClick={() => editMutation.mutate()} disabled={editMutation.isPending}>
                    {editMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                  <Button variant="ghost" onClick={closeEditModal} disabled={editMutation.isPending}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
