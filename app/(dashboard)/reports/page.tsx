"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { StatCard } from "@/components/ui/StatCard";
import { formatTaka } from "@/lib/utils";

type TrendPoint = {
  period: string;
  sale_count: number;
  sales_total: number;
  due_total: number;
  due_collected: number;
  expense_total: number;
  gross_profit: number;
  net_profit: number;
};

type ReportsOverviewResponse = {
  generated_at: string;
  outstanding_due: number;
  daily_summary: TrendPoint;
  monthly_summary: TrendPoint;
  daily_trend: TrendPoint[];
  monthly_trend: TrendPoint[];
  meta: {
    day_window: number;
    month_window: number;
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

type GroupBy = "day" | "month";
type MetricKey = "sales_total" | "due_total" | "expense_total" | "net_profit";
type ProductSortBy = "profit" | "margin";

type RangeSummary = {
  sale_count: number;
  sales_total: number;
  due_total: number;
  due_collected: number;
  expense_total: number;
  gross_profit: number;
  net_profit: number;
  outstanding_due: number;
};

type RangeResponse = {
  range: {
    from: string;
    to: string;
    group_by: GroupBy;
  };
  summary: RangeSummary;
  trend: TrendPoint[];
  meta: {
    points: number;
  };
};

type ProductProfitRow = {
  rank: number;
  product_id: string;
  product_name: string;
  total_quantity: number;
  sales_total: number;
  cost_total: number;
  gross_profit: number;
  margin_percent: number;
};

type ProductProfitResponse = {
  range: {
    from: string;
    to: string;
  };
  sort_by: ProductSortBy;
  products: ProductProfitRow[];
  meta: {
    count: number;
    limit: number;
  };
};

const metricOptions: Array<{ key: MetricKey; label: string; color: string; fill: string }> = [
  { key: "sales_total", label: "Sales", color: "#2563eb", fill: "#dbeafe" },
  { key: "due_total", label: "Due", color: "#d97706", fill: "#ffedd5" },
  { key: "expense_total", label: "Expenses", color: "#dc2626", fill: "#fee2e2" },
  { key: "net_profit", label: "Net Profit", color: "#059669", fill: "#d1fae5" },
];

function formatInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildDefaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 29);

  return {
    from: formatInputDate(start),
    to: formatInputDate(end),
  };
}

async function fetchReportsOverview() {
  const res = await fetch("/api/reports/overview", {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<ReportsOverviewResponse> | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load reports");
  }

  return payload.data;
}

async function fetchRangeReports(from: string, to: string, groupBy: GroupBy) {
  const params = new URLSearchParams({
    from,
    to,
    groupBy,
  });

  const res = await fetch(`/api/reports/range?${params.toString()}`, {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<RangeResponse> | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load range reports");
  }

  return payload.data;
}

async function fetchProductProfitReport(
  from: string,
  to: string,
  sortBy: ProductSortBy,
  limit: number,
) {
  const params = new URLSearchParams({
    from,
    to,
    sortBy,
    limit: String(limit),
  });

  const res = await fetch(`/api/reports/products?${params.toString()}`, {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<ProductProfitResponse> | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load product-wise profit report");
  }

  return payload.data;
}

function formatCompactMoney(value: number) {
  return new Intl.NumberFormat("en-BD", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDayLabel(dayKey: string) {
  const date = new Date(`${dayKey}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-BD", {
    month: "short",
    day: "2-digit",
  }).format(date);
}

function formatMonthLabel(monthKey: string) {
  const date = new Date(`${monthKey}-01T00:00:00Z`);
  return new Intl.DateTimeFormat("en-BD", {
    month: "short",
    year: "2-digit",
  }).format(date);
}

function formatRangeLabel(period: string, groupBy: GroupBy) {
  return groupBy === "day" ? formatDayLabel(period) : formatMonthLabel(period);
}

function validateDateInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function exportRangePdf(
  from: string,
  to: string,
  rangeData: RangeResponse,
  productsData: ProductProfitResponse,
) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFontSize(14);
  doc.text("ShopERP Report", 40, 40);
  doc.setFontSize(10);
  doc.text(`Range: ${from} to ${to}`, 40, 58);

  autoTable(doc, {
    startY: 74,
    head: [["Metric", "Value"]],
    body: [
      ["Sales", formatTaka(rangeData.summary.sales_total)],
      ["Due Created", formatTaka(rangeData.summary.due_total)],
      ["Due Collected", formatTaka(rangeData.summary.due_collected)],
      ["Expenses", formatTaka(rangeData.summary.expense_total)],
      ["Gross Profit", formatTaka(rangeData.summary.gross_profit)],
      ["Net Profit", formatTaka(rangeData.summary.net_profit)],
      ["Outstanding Due", formatTaka(rangeData.summary.outstanding_due)],
    ],
    styles: { fontSize: 9 },
  });

  const summaryLastY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 140;

  autoTable(doc, {
    startY: summaryLastY + 18,
    head: [["Rank", "Product", "Qty", "Sales", "Cost", "Profit", "Margin %"]],
    body: productsData.products.slice(0, 12).map((row) => [
      row.rank,
      row.product_name,
      row.total_quantity,
      formatTaka(row.sales_total),
      formatTaka(row.cost_total),
      formatTaka(row.gross_profit),
      `${row.margin_percent.toFixed(2)}%`,
    ]),
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: [15, 23, 42] },
  });

  doc.save(`reports-${from}-to-${to}.pdf`);
}

function exportRangeExcel(from: string, to: string, rangeData: RangeResponse, productsData: ProductProfitResponse) {
  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet([
    { metric: "Invoices", value: rangeData.summary.sale_count },
    { metric: "Sales", value: rangeData.summary.sales_total },
    { metric: "Due Created", value: rangeData.summary.due_total },
    { metric: "Due Collected", value: rangeData.summary.due_collected },
    { metric: "Expenses", value: rangeData.summary.expense_total },
    { metric: "Gross Profit", value: rangeData.summary.gross_profit },
    { metric: "Net Profit", value: rangeData.summary.net_profit },
    { metric: "Outstanding Due", value: rangeData.summary.outstanding_due },
  ]);

  const trendSheet = XLSX.utils.json_to_sheet(
    rangeData.trend.map((row) => ({
      period: row.period,
      invoices: row.sale_count,
      sales: row.sales_total,
      due_created: row.due_total,
      due_collected: row.due_collected,
      expenses: row.expense_total,
      gross_profit: row.gross_profit,
      net_profit: row.net_profit,
    })),
  );

  const productsSheet = XLSX.utils.json_to_sheet(
    productsData.products.map((row) => ({
      rank: row.rank,
      product: row.product_name,
      quantity: row.total_quantity,
      sales: row.sales_total,
      cost: row.cost_total,
      gross_profit: row.gross_profit,
      margin_percent: row.margin_percent,
    })),
  );

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, trendSheet, "Trend");
  XLSX.utils.book_append_sheet(workbook, productsSheet, "Product Profit");

  XLSX.writeFile(workbook, `reports-${from}-to-${to}.xlsx`);
}

export default function ReportsPage() {
  const defaults = useMemo(() => buildDefaultDateRange(), []);

  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const [productSortBy, setProductSortBy] = useState<ProductSortBy>("profit");
  const [productLimit, setProductLimit] = useState(12);

  const [dailyMetric, setDailyMetric] = useState<MetricKey>("sales_total");
  const [monthlyMetric, setMonthlyMetric] = useState<MetricKey>("net_profit");
  const [rangeMetric, setRangeMetric] = useState<MetricKey>("net_profit");

  const isCustomRangeValid = useMemo(
    () => validateDateInput(fromDate) && validateDateInput(toDate) && fromDate <= toDate,
    [fromDate, toDate],
  );

  const {
    data: overviewData,
    isLoading: overviewLoading,
    isError: overviewError,
  } = useQuery({
    queryKey: ["reports-overview"],
    queryFn: fetchReportsOverview,
  });

  const {
    data: rangeData,
    isLoading: rangeLoading,
    isError: rangeError,
  } = useQuery({
    queryKey: ["reports-range", fromDate, toDate, groupBy],
    queryFn: () => fetchRangeReports(fromDate, toDate, groupBy),
    enabled: isCustomRangeValid,
  });

  const {
    data: productData,
    isLoading: productsLoading,
    isError: productsError,
  } = useQuery({
    queryKey: ["reports-products", fromDate, toDate, productSortBy, productLimit],
    queryFn: () => fetchProductProfitReport(fromDate, toDate, productSortBy, productLimit),
    enabled: isCustomRangeValid,
  });

  const dailyChartData = useMemo(
    () =>
      (overviewData?.daily_trend ?? []).map((row) => ({
        ...row,
        label: formatDayLabel(row.period),
      })),
    [overviewData],
  );

  const monthlyChartData = useMemo(
    () =>
      (overviewData?.monthly_trend ?? []).map((row) => ({
        ...row,
        label: formatMonthLabel(row.period),
      })),
    [overviewData],
  );

  const rangeChartData = useMemo(
    () =>
      (rangeData?.trend ?? []).map((row) => ({
        ...row,
        label: formatRangeLabel(row.period, groupBy),
      })),
    [groupBy, rangeData],
  );

  const selectedDailyMetric = metricOptions.find((item) => item.key === dailyMetric) ?? metricOptions[0];
  const selectedMonthlyMetric =
    metricOptions.find((item) => item.key === monthlyMetric) ?? metricOptions[0];
  const selectedRangeMetric = metricOptions.find((item) => item.key === rangeMetric) ?? metricOptions[0];

  async function handleExportPdf() {
    if (!rangeData || !productData) {
      toast.error("Load custom range report data before exporting PDF");
      return;
    }

    try {
      await exportRangePdf(fromDate, toDate, rangeData, productData);
      toast.success("PDF exported");
    } catch {
      toast.error("Failed to export PDF");
    }
  }

  function handleExportExcel() {
    if (!rangeData || !productData) {
      toast.error("Load custom range report data before exporting Excel");
      return;
    }

    try {
      exportRangeExcel(fromDate, toDate, rangeData, productData);
      toast.success("Excel exported");
    } catch {
      toast.error("Failed to export Excel");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Reports Dashboard</h2>
          <p className="text-sm text-slate-500">Daily/monthly analytics with export and custom date-range analysis</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handleExportPdf}>
            Export PDF
          </Button>
          <Button variant="secondary" onClick={handleExportExcel}>
            Export Excel
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Input
            label="From"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
          <Input
            label="To"
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Trend Grouping</span>
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value as GroupBy)}
            >
              <option value="day">Day</option>
              <option value="month">Month</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Product Ranking</span>
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              value={productSortBy}
              onChange={(event) => setProductSortBy(event.target.value as ProductSortBy)}
            >
              <option value="profit">Top by Profit</option>
              <option value="margin">Top by Margin %</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Top Products</span>
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              value={String(productLimit)}
              onChange={(event) => setProductLimit(Number(event.target.value))}
            >
              <option value="10">Top 10</option>
              <option value="20">Top 20</option>
              <option value="30">Top 30</option>
              <option value="50">Top 50</option>
            </select>
          </label>

          <div className="flex flex-col justify-end">
            <Button
              variant="ghost"
              onClick={() => {
                const fallback = buildDefaultDateRange();
                setFromDate(fallback.from);
                setToDate(fallback.to);
                setGroupBy("day");
              }}
            >
              Reset Range
            </Button>
          </div>
        </div>

        {!isCustomRangeValid ? (
          <p className="mt-2 text-xs text-red-600">Please select a valid date range (from date must be before or equal to to date).</p>
        ) : null}
      </Card>

      {overviewLoading ? (
        <Card className="p-5 text-sm text-slate-500">Loading reports...</Card>
      ) : null}

      {overviewError ? (
        <Card className="p-5 text-sm text-red-600">
          Failed to load reports. Please check permission for reports:view.
        </Card>
      ) : null}

      {overviewData ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-slate-900">Today Snapshot</h3>
              <p className="mt-1 text-xs text-slate-500">{overviewData.daily_summary.period}</p>

              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Invoices</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {overviewData.daily_summary.sale_count}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Sales</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {formatTaka(overviewData.daily_summary.sales_total)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Due Created</span>
                  <span className="font-semibold text-amber-700 tabular-nums">
                    {formatTaka(overviewData.daily_summary.due_total)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Due Collected</span>
                  <span className="font-semibold text-emerald-700 tabular-nums">
                    {formatTaka(overviewData.daily_summary.due_collected)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Expenses</span>
                  <span className="font-semibold text-red-700 tabular-nums">
                    {formatTaka(overviewData.daily_summary.expense_total)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                  <span className="font-medium text-slate-700">Net Profit</span>
                  <span
                    className={
                      overviewData.daily_summary.net_profit >= 0
                        ? "font-semibold text-emerald-700 tabular-nums"
                        : "font-semibold text-red-700 tabular-nums"
                    }
                  >
                    {formatTaka(overviewData.daily_summary.net_profit)}
                  </span>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold text-slate-900">This Month Snapshot</h3>
              <p className="mt-1 text-xs text-slate-500">{overviewData.monthly_summary.period}</p>

              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Invoices</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {overviewData.monthly_summary.sale_count}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Sales</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {formatTaka(overviewData.monthly_summary.sales_total)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Due Created</span>
                  <span className="font-semibold text-amber-700 tabular-nums">
                    {formatTaka(overviewData.monthly_summary.due_total)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Due Collected</span>
                  <span className="font-semibold text-emerald-700 tabular-nums">
                    {formatTaka(overviewData.monthly_summary.due_collected)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Expenses</span>
                  <span className="font-semibold text-red-700 tabular-nums">
                    {formatTaka(overviewData.monthly_summary.expense_total)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                  <span className="font-medium text-slate-700">Net Profit</span>
                  <span
                    className={
                      overviewData.monthly_summary.net_profit >= 0
                        ? "font-semibold text-emerald-700 tabular-nums"
                        : "font-semibold text-red-700 tabular-nums"
                    }
                  >
                    {formatTaka(overviewData.monthly_summary.net_profit)}
                  </span>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Outstanding Customer Due"
              value={formatTaka(overviewData.outstanding_due)}
              accent="orange"
              hint="Current unpaid customer balance"
            />
            <StatCard
              title="Month Due Collected"
              value={formatTaka(overviewData.monthly_summary.due_collected)}
              accent="green"
              hint="Collections against previous dues"
            />
            <StatCard
              title="Month Expenses"
              value={formatTaka(overviewData.monthly_summary.expense_total)}
              accent="red"
              hint="Operational spending"
            />
            <StatCard
              title="Month Gross Profit"
              value={formatTaka(overviewData.monthly_summary.gross_profit)}
              accent="blue"
              hint="Before expense deduction"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Daily Trend</h3>
                  <p className="text-xs text-slate-500">Last {overviewData.meta.day_window} days</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {metricOptions.map((option) => (
                    <Button
                      key={option.key}
                      size="sm"
                      variant={dailyMetric === option.key ? "primary" : "ghost"}
                      onClick={() => setDailyMetric(option.key)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} minTickGap={18} />
                    <YAxis
                      tick={{ fill: "#64748b", fontSize: 12 }}
                      tickFormatter={(value: number) => formatCompactMoney(value)}
                      width={56}
                    />
                    <Tooltip
                      formatter={(value) =>
                        formatTaka(Number(Array.isArray(value) ? value[0] : (value ?? 0)))
                      }
                      labelFormatter={(value) => `Date: ${value}`}
                    />
                    <Area
                      type="monotone"
                      dataKey={selectedDailyMetric.key}
                      stroke={selectedDailyMetric.color}
                      fill={selectedDailyMetric.fill}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Monthly Trend</h3>
                  <p className="text-xs text-slate-500">Last {overviewData.meta.month_window} months</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {metricOptions.map((option) => (
                    <Button
                      key={option.key}
                      size="sm"
                      variant={monthlyMetric === option.key ? "primary" : "ghost"}
                      onClick={() => setMonthlyMetric(option.key)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} minTickGap={16} />
                    <YAxis
                      tick={{ fill: "#64748b", fontSize: 12 }}
                      tickFormatter={(value: number) => formatCompactMoney(value)}
                      width={56}
                    />
                    <Tooltip
                      formatter={(value) =>
                        formatTaka(Number(Array.isArray(value) ? value[0] : (value ?? 0)))
                      }
                      labelFormatter={(value) => `Month: ${value}`}
                    />
                    <Area
                      type="monotone"
                      dataKey={selectedMonthlyMetric.key}
                      stroke={selectedMonthlyMetric.color}
                      fill={selectedMonthlyMetric.fill}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">Monthly Breakdown Table</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Month</th>
                    <th className="px-3 py-2 text-right">Invoices</th>
                    <th className="px-3 py-2 text-right">Sales</th>
                    <th className="px-3 py-2 text-right">Due</th>
                    <th className="px-3 py-2 text-right">Expenses</th>
                    <th className="px-3 py-2 text-right">Net Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {overviewData.monthly_trend.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={6}>
                        No monthly records available
                      </td>
                    </tr>
                  ) : (
                    overviewData.monthly_trend.map((row) => (
                      <tr key={row.period} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-700">{formatMonthLabel(row.period)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.sale_count}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatTaka(row.sales_total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                          {formatTaka(row.due_total)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-700">
                          {formatTaka(row.expense_total)}
                        </td>
                        <td
                          className={
                            row.net_profit >= 0
                              ? "px-3 py-2 text-right tabular-nums text-emerald-700"
                              : "px-3 py-2 text-right tabular-nums text-red-700"
                          }
                        >
                          {formatTaka(row.net_profit)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Custom Date-Range Summary</h3>
                <p className="text-xs text-slate-500">
                  {fromDate} to {toDate} grouped by {groupBy}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {metricOptions.map((option) => (
                  <Button
                    key={option.key}
                    size="sm"
                    variant={rangeMetric === option.key ? "primary" : "ghost"}
                    onClick={() => setRangeMetric(option.key)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            {rangeLoading ? <p className="mt-4 text-sm text-slate-500">Loading date-range report...</p> : null}
            {rangeError ? (
              <p className="mt-4 text-sm text-red-600">Failed to load custom range report.</p>
            ) : null}

            {rangeData ? (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard title="Range Sales" value={formatTaka(rangeData.summary.sales_total)} accent="blue" />
                  <StatCard title="Range Due" value={formatTaka(rangeData.summary.due_total)} accent="orange" />
                  <StatCard title="Range Expenses" value={formatTaka(rangeData.summary.expense_total)} accent="red" />
                  <StatCard
                    title="Range Net Profit"
                    value={formatTaka(rangeData.summary.net_profit)}
                    accent={rangeData.summary.net_profit >= 0 ? "green" : "red"}
                  />
                </div>

                <div className="mt-4 h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={rangeChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} minTickGap={16} />
                      <YAxis
                        tick={{ fill: "#64748b", fontSize: 12 }}
                        tickFormatter={(value: number) => formatCompactMoney(value)}
                        width={56}
                      />
                      <Tooltip
                        formatter={(value) =>
                          formatTaka(Number(Array.isArray(value) ? value[0] : (value ?? 0)))
                        }
                        labelFormatter={(value) => `${groupBy === "day" ? "Date" : "Period"}: ${value}`}
                      />
                      <Area
                        type="monotone"
                        dataKey={selectedRangeMetric.key}
                        stroke={selectedRangeMetric.color}
                        fill={selectedRangeMetric.fill}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : null}
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">Product-Wise Profit Ranking</h3>
            </div>

            {productsLoading ? <p className="px-4 py-6 text-sm text-slate-500">Loading product report...</p> : null}
            {productsError ? (
              <p className="px-4 py-6 text-sm text-red-600">Failed to load product-wise profit report.</p>
            ) : null}

            {productData ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Rank</th>
                      <th className="px-3 py-2 text-left">Product</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Sales</th>
                      <th className="px-3 py-2 text-right">Cost</th>
                      <th className="px-3 py-2 text-right">Profit</th>
                      <th className="px-3 py-2 text-right">Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productData.products.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                          No product sales found in this range
                        </td>
                      </tr>
                    ) : (
                      productData.products.map((item) => (
                        <tr key={item.product_id} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-medium text-slate-900">#{item.rank}</td>
                          <td className="px-3 py-2 text-slate-700">{item.product_name}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{item.total_quantity}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatTaka(item.sales_total)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatTaka(item.cost_total)}</td>
                          <td
                            className={
                              item.gross_profit >= 0
                                ? "px-3 py-2 text-right tabular-nums text-emerald-700"
                                : "px-3 py-2 text-right tabular-nums text-red-700"
                            }
                          >
                            {formatTaka(item.gross_profit)}
                          </td>
                          <td
                            className={
                              item.margin_percent >= 0
                                ? "px-3 py-2 text-right tabular-nums text-emerald-700"
                                : "px-3 py-2 text-right tabular-nums text-red-700"
                            }
                          >
                            {item.margin_percent.toFixed(2)}%
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}
