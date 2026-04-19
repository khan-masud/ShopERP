"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { StatCard } from "@/components/ui/StatCard";
import { formatDateTime } from "@/lib/utils";

type AuditLogItem = {
  id: string;
  action: string;
  table_name: string | null;
  record_id: string | null;
  detail: string;
  user_name: string | null;
  user_email: string | null;
  ip_address: string | null;
  created_at: string;
};

type AuditResponse = {
  logs: AuditLogItem[];
  total_count: number;
  page: number;
  page_size: number;
  total_pages: number;
  filter_options: {
    actions: string[];
    tables: string[];
    user_names: string[];
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

async function fetchAuditLogs(filters: {
  search: string;
  action: string;
  table: string;
  userName: string;
  fromDate: string;
  toDate: string;
  page: number;
  pageSize: number;
}) {
  const params = new URLSearchParams();

  if (filters.search.trim()) {
    params.set("q", filters.search.trim());
  }

  if (filters.action.trim()) {
    params.set("action", filters.action.trim());
  }

  if (filters.table.trim()) {
    params.set("table", filters.table.trim());
  }

  if (filters.userName.trim()) {
    params.set("userName", filters.userName.trim());
  }

  if (filters.fromDate) {
    params.set("from", filters.fromDate);
  }

  if (filters.toDate) {
    params.set("to", filters.toDate);
  }

  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));

  const query = params.toString();
  const res = await fetch(query ? `/api/audit?${query}` : "/api/audit", {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<AuditResponse> | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load audit logs");
  }

  return payload.data;
}

function toApiDateInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const match = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) {
    return "";
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() + 1 !== month
    || candidate.getUTCDate() !== day
  ) {
    return "";
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function AuditPage() {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [table, setTable] = useState("");
  const [userName, setUserName] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const fromDateApi = toApiDateInput(fromDate);
  const toDateApi = toApiDateInput(toDate);

  const {
    data,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["audit-logs", search, action, table, userName, fromDateApi, toDateApi, page, pageSize],
    queryFn: () => fetchAuditLogs({
      search,
      action,
      table,
      userName,
      fromDate: fromDateApi,
      toDate: toDateApi,
      page,
      pageSize,
    }),
  });

  const logs = useMemo(() => data?.logs ?? [], [data]);
  const totalCount = data?.total_count ?? 0;
  const totalPages = data?.total_pages ?? 1;
  const activePage = data?.page ?? page;
  const activePageSize = data?.page_size ?? pageSize;

  const showingFrom = totalCount === 0 ? 0 : (activePage - 1) * activePageSize + 1;
  const showingTo = totalCount === 0 ? 0 : Math.min(activePage * activePageSize, totalCount);

  const uniqueUsers = useMemo(
    () => new Set(logs.map((item) => item.user_email || "").filter(Boolean)).size,
    [logs],
  );

  const uniqueActions = useMemo(
    () => new Set(logs.map((item) => item.action).filter(Boolean)).size,
    [logs],
  );

  const actionOptions = data?.filter_options?.actions ?? [];
  const tableOptions = data?.filter_options?.tables ?? [];
  const userNameOptions = data?.filter_options?.user_names ?? [];

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Input
            label="Search"
            placeholder="Action, detail, record id"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className="xl:col-span-2"
          />

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Action</span>
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All Actions</option>
              {actionOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Table</span>
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              value={table}
              onChange={(event) => {
                setTable(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All Tables</option>
              {tableOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">User Name</span>
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              value={userName}
              onChange={(event) => {
                setUserName(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All Users</option>
              {userNameOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <Input
            label="From"
            type="text"
            placeholder="DD-MM-YYYY"
            value={fromDate}
            onChange={(event) => {
              setFromDate(event.target.value);
              setPage(1);
            }}
          />

          <Input
            label="To"
            type="text"
            placeholder="DD-MM-YYYY"
            value={toDate}
            onChange={(event) => {
              setToDate(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard title="Matched Logs" value={String(logs.length)} accent="blue" />
        <StatCard title="Total Matching Records" value={String(totalCount)} accent="green" />
        <StatCard title="Actors / Actions" value={`${uniqueUsers} / ${uniqueActions}`} accent="orange" />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Event Timeline</h3>
        </div>

        {isLoading ? <p className="px-4 py-6 text-sm text-slate-500">Loading audit logs...</p> : null}
        {isError ? <p className="px-4 py-6 text-sm text-red-600">Failed to load audit logs.</p> : null}

        {!isLoading && !isError ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">Action</th>
                  <th className="px-3 py-2 text-left">Table</th>
                  <th className="px-3 py-2 text-left">Record</th>
                  <th className="px-3 py-2 text-left">User</th>
                  <th className="px-3 py-2 text-left">IP</th>
                  <th className="px-3 py-2 text-left">Detail</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-slate-500" colSpan={7}>
                      No audit logs found
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{formatDateTime(log.created_at)}</td>
                      <td className="px-3 py-2 font-medium text-slate-900">{log.action}</td>
                      <td className="px-3 py-2 text-slate-700">{log.table_name || "-"}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{log.record_id || "-"}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">
                        {log.user_name || log.user_email
                          ? `${log.user_name || "Unknown"} (${log.user_email || "no-email"})`
                          : "System"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{log.ip_address || "-"}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{log.detail}</td>
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
              Showing {showingFrom}-{showingTo} of {totalCount}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <span>Rows</span>
                <select
                  className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                  value={String(activePageSize)}
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
                disabled={activePage <= 1}
              >
                Previous
              </Button>

              <span className="min-w-24 text-center text-xs text-slate-600">
                Page {activePage} of {totalPages}
              </span>

              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={activePage >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
