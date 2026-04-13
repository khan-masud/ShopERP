"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { formatDateTime, formatTaka } from "@/lib/utils";

type RangeFilter = "day" | "week" | "month" | "year" | "all";

type StaffSalesRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  is_active: number;
  sale_count: number;
  total_sales: string;
  total_paid: string;
  total_due: string;
  last_sale_at: string | null;
};

type StaffSummaryResponse = {
  staffs: StaffSalesRow[];
  range: RangeFilter;
  summary: {
    total_staff: number;
    sale_count: number;
    total_sales: string;
    total_paid: string;
    total_due: string;
  };
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

const rangeLabelMap: Record<RangeFilter, string> = {
  day: "Today",
  week: "This Week",
  month: "This Month",
  year: "This Year",
  all: "All Time",
};

async function fetchStaffSummary(filters: {
  search: string;
  range: RangeFilter;
  includeInactive: boolean;
  page: number;
  pageSize: number;
}) {
  const params = new URLSearchParams({
    range: filters.range,
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  });

  if (filters.search.trim()) {
    params.set("q", filters.search.trim());
  }

  if (filters.includeInactive) {
    params.set("includeInactive", "1");
  }

  const res = await fetch(`/api/staff-summary?${params.toString()}`, {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<StaffSummaryResponse> | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load staff summary");
  }

  return payload.data;
}

export default function StaffSummaryPage() {
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<RangeFilter>("month");
  const [includeInactive, setIncludeInactive] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const {
    data,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["staff-summary", search, range, includeInactive, page, pageSize],
    queryFn: () =>
      fetchStaffSummary({
        search,
        range,
        includeInactive,
        page,
        pageSize,
      }),
  });

  const staffs = data?.staffs ?? [];
  const summary = data?.summary ?? {
    total_staff: 0,
    sale_count: 0,
    total_sales: "0.00",
    total_paid: "0.00",
    total_due: "0.00",
  };

  const pagination = useMemo(
    () =>
      data?.pagination ?? {
        page,
        page_size: pageSize,
        total_count: staffs.length,
        total_pages: 1,
      },
    [data, page, pageSize, staffs.length],
  );

  const showingFrom =
    pagination.total_count === 0 ? 0 : (pagination.page - 1) * pagination.page_size + 1;
  const showingTo =
    pagination.total_count === 0
      ? 0
      : Math.min(pagination.page * pagination.page_size, pagination.total_count);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Staff Sales Summary</h2>
        <p className="text-sm text-slate-500">Track who sold how much with day/week/month/year/all-time filters</p>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input
            label="Search"
            placeholder="Staff name, email, or phone"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className="xl:col-span-2"
          />

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Range</span>
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              value={range}
              onChange={(event) => {
                setRange(event.target.value as RangeFilter);
                setPage(1);
              }}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
              <option value="all">All Time</option>
            </select>
          </label>

          <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => {
                setIncludeInactive(event.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            Include inactive staff
          </label>

          <div className="flex items-end justify-end">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setSearch("");
                setRange("month");
                setIncludeInactive(true);
                setPage(1);
              }}
            >
              Reset Filters
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Range" value={rangeLabelMap[data?.range ?? range]} accent="blue" />
        <StatCard title="Staff" value={String(summary.total_staff)} accent="green" />
        <StatCard title="Invoices" value={String(summary.sale_count)} accent="orange" />
        <StatCard title="Total Sales" value={formatTaka(summary.total_sales)} accent="blue" />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Staff Wise Sales</h3>
        </div>

        {isLoading ? <p className="px-4 py-6 text-sm text-slate-500">Loading staff summary...</p> : null}
        {isError ? <p className="px-4 py-6 text-sm text-red-600">Failed to load staff summary.</p> : null}

        {!isLoading && !isError ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Staff</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Invoices</th>
                  <th className="px-3 py-2 text-right">Total Sales</th>
                  <th className="px-3 py-2 text-right">Total Paid</th>
                  <th className="px-3 py-2 text-right">Total Due</th>
                  <th className="px-3 py-2 text-left">Last Sale</th>
                </tr>
              </thead>
              <tbody>
                {staffs.length === 0 ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-slate-500" colSpan={7}>
                      No staff summary found for selected filter
                    </td>
                  </tr>
                ) : (
                  staffs.map((staff) => (
                    <tr key={staff.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-900">{staff.name}</p>
                        <p className="text-xs text-slate-500">{staff.email}</p>
                        <p className="text-xs text-slate-500">{staff.phone || "-"}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            staff.is_active === 1
                              ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700"
                              : "rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700"
                          }
                        >
                          {staff.is_active === 1 ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{staff.sale_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">
                        {formatTaka(staff.total_sales)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                        {formatTaka(staff.total_paid)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                        {formatTaka(staff.total_due)}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {staff.last_sale_at ? formatDateTime(staff.last_sale_at) : "No sales"}
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
    </div>
  );
}
