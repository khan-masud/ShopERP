"use client";

import { useEffect, useMemo, useState } from "react";
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

type GroupBy = "day" | "month";
type MetricKey = "sales_total" | "due_total" | "expense_total" | "net_profit";
type ProductSortBy = "profit" | "margin";

type RangeResponse = {
  range: {
    from: string;
    to: string;
    group_by: GroupBy;
  };
  summary: {
    sale_count: number;
    sales_total: number;
    due_total: number;
    due_collected: number;
    expense_total: number;
    gross_profit: number;
    net_profit: number;
    outstanding_due: number;
  };
  trend: TrendPoint[];
  inventory?: {
    snapshot: {
      total_products: number;
      total_stock_units: number;
      low_stock_count: number;
      out_of_stock_count: number;
      stock_value_buy: number;
      stock_value_sell: number;
    };
    movement: {
      restocked_units: number;
      sold_units: number;
      adjustment_net_units: number;
    };
  };
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

type ApiSuccess<T> = {
  success: true;
  data: T;
};

type ApiErrorPayload = {
  success: false;
  message?: string;
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
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load analytics overview");
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
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load range analytics");
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
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load product analytics");
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

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPercent(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }

  return (numerator / denominator) * 100;
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "N/A";
  }

  return `${value.toFixed(1)}%`;
}

function calculateWindowGrowth(points: TrendPoint[], key: MetricKey, windowSize = 7) {
  if (points.length < windowSize * 2) {
    return null;
  }

  const current = points
    .slice(-windowSize)
    .reduce((sum, point) => sum + toNumber(point[key]), 0);
  const previous = points
    .slice(-windowSize * 2, -windowSize)
    .reduce((sum, point) => sum + toNumber(point[key]), 0);

  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }

  return ((current - previous) / Math.abs(previous)) * 100;
}

export default function AnalyticsPage() {
  const defaults = useMemo(() => buildDefaultDateRange(), []);

  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const [productSortBy, setProductSortBy] = useState<ProductSortBy>("profit");
  const [productLimit, setProductLimit] = useState(12);

  const [dailyMetric, setDailyMetric] = useState<MetricKey>("sales_total");
  const [monthlyMetric, setMonthlyMetric] = useState<MetricKey>("net_profit");
  const [rangeMetric, setRangeMetric] = useState<MetricKey>("net_profit");
  const [isChartClientReady, setIsChartClientReady] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsChartClientReady(true);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  const isCustomRangeValid = useMemo(
    () => validateDateInput(fromDate) && validateDateInput(toDate) && fromDate <= toDate,
    [fromDate, toDate],
  );

  const {
    data: overviewData,
    isLoading: overviewLoading,
    isError: overviewError,
  } = useQuery({
    queryKey: ["analytics-overview"],
    queryFn: fetchReportsOverview,
  });

  const {
    data: rangeData,
    isLoading: rangeLoading,
    isError: rangeError,
  } = useQuery({
    queryKey: ["analytics-range", fromDate, toDate, groupBy],
    queryFn: () => fetchRangeReports(fromDate, toDate, groupBy),
    enabled: isCustomRangeValid,
  });

  const {
    data: productData,
    isLoading: productsLoading,
    isError: productsError,
  } = useQuery({
    queryKey: ["analytics-products", fromDate, toDate, productSortBy, productLimit],
    queryFn: () => fetchProductProfitReport(fromDate, toDate, productSortBy, productLimit),
    enabled: isCustomRangeValid,
  });

  const dailyChartData = useMemo(
    () =>
      (overviewData?.daily_trend ?? []).map((point) => ({
        ...point,
        label: formatDayLabel(point.period),
      })),
    [overviewData],
  );

  const monthlyChartData = useMemo(
    () =>
      (overviewData?.monthly_trend ?? []).map((point) => ({
        ...point,
        label: formatMonthLabel(point.period),
      })),
    [overviewData],
  );

  const rangeChartData = useMemo(
    () =>
      (rangeData?.trend ?? []).map((point) => ({
        ...point,
        label: formatRangeLabel(point.period, groupBy),
      })),
    [groupBy, rangeData],
  );

  const selectedDailyMetric = metricOptions.find((item) => item.key === dailyMetric) ?? metricOptions[0];
  const selectedMonthlyMetric =
    metricOptions.find((item) => item.key === monthlyMetric) ?? metricOptions[0];
  const selectedRangeMetric = metricOptions.find((item) => item.key === rangeMetric) ?? metricOptions[0];

  const weeklySalesGrowth = useMemo(
    () => calculateWindowGrowth(overviewData?.daily_trend ?? [], "sales_total", 7),
    [overviewData],
  );

  const weeklyProfitGrowth = useMemo(
    () => calculateWindowGrowth(overviewData?.daily_trend ?? [], "net_profit", 7),
    [overviewData],
  );

  const monthlyCollectionEfficiency = useMemo(() => {
    if (!overviewData) {
      return null;
    }

    const dueCollected = toNumber(overviewData.monthly_summary.due_collected);
    const dueCreated = toNumber(overviewData.monthly_summary.due_total);
    return toPercent(dueCollected, dueCollected + dueCreated);
  }, [overviewData]);

  const monthlyExpenseRatio = useMemo(() => {
    if (!overviewData) {
      return null;
    }

    const expenses = toNumber(overviewData.monthly_summary.expense_total);
    const sales = toNumber(overviewData.monthly_summary.sales_total);
    return toPercent(expenses, sales);
  }, [overviewData]);

  const monthlyNetMargin = useMemo(() => {
    if (!overviewData) {
      return null;
    }

    const netProfit = toNumber(overviewData.monthly_summary.net_profit);
    const sales = toNumber(overviewData.monthly_summary.sales_total);
    return toPercent(netProfit, sales);
  }, [overviewData]);

  const inventoryRisk = useMemo(() => {
    const snapshot = rangeData?.inventory?.snapshot;
    if (!snapshot || snapshot.total_products <= 0) {
      return null;
    }

    const atRisk = snapshot.low_stock_count + snapshot.out_of_stock_count;
    return toPercent(atRisk, snapshot.total_products);
  }, [rangeData]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Business Analytics</h2>
        <p className="text-sm text-slate-500">
          Growth, trend, and performance visualization to track business momentum.
        </p>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
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

          <div className="flex items-end gap-2">
            <label className="flex w-full flex-col gap-1.5">
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                const fallback = buildDefaultDateRange();
                setFromDate(fallback.from);
                setToDate(fallback.to);
                setGroupBy("day");
                setProductSortBy("profit");
                setProductLimit(12);
              }}
            >
              Reset
            </Button>
          </div>
        </div>

        {!isCustomRangeValid ? (
          <p className="mt-2 text-xs text-red-600">
            Please select a valid date range (from date must be before or equal to to date).
          </p>
        ) : null}
      </Card>

      {overviewLoading ? <Card className="p-5 text-sm text-slate-500">Loading analytics...</Card> : null}
      {overviewError ? (
        <Card className="p-5 text-sm text-red-600">
          Failed to load analytics. Please check permission for reports:view.
        </Card>
      ) : null}

      {overviewData ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Monthly Sales"
              value={formatTaka(overviewData.monthly_summary.sales_total)}
              accent="blue"
              hint="Current month"
            />
            <StatCard
              title="Monthly Net Profit"
              value={formatTaka(overviewData.monthly_summary.net_profit)}
              accent={overviewData.monthly_summary.net_profit >= 0 ? "green" : "red"}
              hint="After expenses"
            />
            <StatCard
              title="Outstanding Due"
              value={formatTaka(overviewData.outstanding_due)}
              accent="orange"
              hint="Current unpaid balance"
            />
            <StatCard
              title="Due Collection Efficiency"
              value={formatPercent(monthlyCollectionEfficiency)}
              accent="green"
              hint="Collected vs created dues"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weekly Sales Growth</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">{formatPercent(weeklySalesGrowth)}</p>
              <p className="mt-1 text-xs text-slate-500">Last 7 days vs previous 7 days</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weekly Profit Growth</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">{formatPercent(weeklyProfitGrowth)}</p>
              <p className="mt-1 text-xs text-slate-500">Net profit momentum trend</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Monthly Expense Ratio</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">{formatPercent(monthlyExpenseRatio)}</p>
              <p className="mt-1 text-xs text-slate-500">Expense as percentage of sales</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Monthly Net Margin</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">{formatPercent(monthlyNetMargin)}</p>
              <p className="mt-1 text-xs text-slate-500">Net profit over revenue</p>
            </Card>
          </div>

          <Card className="p-4">
            <h3 className="text-sm font-semibold text-slate-900">Inventory Signal (Selected Range)</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Total Products</p>
                <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
                  {rangeData?.inventory?.snapshot.total_products ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Total Stock Units</p>
                <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
                  {toNumber(rangeData?.inventory?.snapshot.total_stock_units ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Low + Out Risk</p>
                <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">{formatPercent(inventoryRisk)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Stock Buy Value</p>
                <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
                  {formatTaka(toNumber(rangeData?.inventory?.snapshot.stock_value_buy ?? 0))}
                </p>
              </div>
            </div>
          </Card>

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

              <div className="mt-4 h-72 min-w-0">
                {isChartClientReady ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
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
                ) : (
                  <div className="h-full w-full" />
                )}
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

              <div className="mt-4 h-72 min-w-0">
                {isChartClientReady ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <AreaChart data={monthlyChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                ) : (
                  <div className="h-full w-full" />
                )}
              </div>
            </Card>
          </div>

          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Custom Range Trend</h3>
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

            {rangeLoading ? <p className="mt-4 text-sm text-slate-500">Loading custom range analytics...</p> : null}
            {rangeError ? <p className="mt-4 text-sm text-red-600">Failed to load custom range analytics.</p> : null}

            {rangeData ? (
              <div className="mt-4 h-72 min-w-0">
                {isChartClientReady ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <AreaChart data={rangeChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                ) : (
                  <div className="h-full w-full" />
                )}
              </div>
            ) : null}
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">Product Contribution Analytics</h3>
            </div>

            {productsLoading ? <p className="px-4 py-6 text-sm text-slate-500">Loading product analytics...</p> : null}
            {productsError ? <p className="px-4 py-6 text-sm text-red-600">Failed to load product analytics.</p> : null}

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
