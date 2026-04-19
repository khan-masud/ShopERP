"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { formatDate, formatDateTime, formatTaka, getRuntimeSiteSettings } from "@/lib/utils";

type GroupBy = "day" | "month";
type SpecialReportCardKey =
  | "daily"
  | "previous_day"
  | "last_week"
  | "last_15_days"
  | "last_month"
  | "last_3_month"
  | "last_6_month"
  | "last_12_month"
  | "custom";

type ApiSuccess<T> = {
  success: true;
  data: T;
};

type ApiErrorPayload = {
  success: false;
  message?: string;
};

type SummaryResponse = {
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
    sales_amount_collected: number;
    net_sales_amount: number;
    total_customers: number;
    due_customers_count: number;
    outstanding_due: number;
  };
  trend: Array<{
    period: string;
    sale_count: number;
    sales_total: number;
    due_total: number;
    due_collected: number;
    expense_total: number;
    gross_profit: number;
    net_profit: number;
  }>;
  inventory: {
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
  expense_breakdown: Array<{
    category: string;
    expense_count: number;
    total_amount: number;
  }>;
  top_due_customers: Array<{
    id: string;
    name: string | null;
    phone: string;
    due: number;
  }>;
  stock_changes: Array<{
    id: string;
    product_id: string;
    product_name: string;
    entry_count: number;
    restocked_units: number;
    sold_units: number;
    adjustment_units: number;
    net_change_units: number;
    last_changed_at: string;
  }>;
};

const labelByKey: Record<SpecialReportCardKey, string> = {
  daily: "Daily Report",
  previous_day: "Previous Day Report",
  last_week: "Last Week Report",
  last_15_days: "Last 15 Days Report",
  last_month: "Last Month Report",
  last_3_month: "Last 3 Month Report",
  last_6_month: "Last 6 Month Report",
  last_12_month: "Last 12 Month Report",
  custom: "Custom Range Report",
};

function isIsoDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUnits(value: number) {
  return new Intl.NumberFormat("en-BD", {
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function formatMonthValue(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return value;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = new Date(Date.UTC(year, month - 1, 1));

  const shortMonth = new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC",
  }).format(date);

  return `${shortMonth}-${year}`;
}

function formatSpecialPeriod(period: string, groupBy: GroupBy) {
  if (groupBy === "month") {
    return formatMonthValue(period);
  }

  return formatDate(period);
}

function paginateRows<T>(rows: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const offset = (safePage - 1) * pageSize;

  return {
    rows: rows.slice(offset, offset + pageSize),
    page: safePage,
    totalPages,
    totalCount: rows.length,
  };
}

function getSummaryItems(report: SummaryResponse) {
  return [
    { label: "Sell", value: String(report.summary.sale_count) },
    { label: "Sales Total", value: formatTaka(report.summary.sales_total) },
    { label: "Total Due", value: formatTaka(report.summary.due_total) },
    { label: "Due Collected", value: formatTaka(report.summary.due_collected) },
    { label: "Total Expenses", value: formatTaka(report.summary.expense_total) },
    { label: "Gross Profit", value: formatTaka(report.summary.gross_profit) },
    { label: "Net Profit", value: formatTaka(report.summary.net_profit) },
    { label: "Sales Amount Collected", value: formatTaka(report.summary.sales_amount_collected) },
    { label: "Net Sales Amount", value: formatTaka(report.summary.net_sales_amount) },
    { label: "Total Customers", value: String(report.summary.total_customers) },
    { label: "Due Customers", value: String(report.summary.due_customers_count) },
    { label: "Total Due (Overall)", value: formatTaka(report.summary.outstanding_due) },
    { label: "Total Products", value: String(report.inventory.snapshot.total_products) },
    { label: "Low Stock Products", value: String(report.inventory.snapshot.low_stock_count) },
    { label: "Out Of Stock Products", value: String(report.inventory.snapshot.out_of_stock_count) },
    { label: "Stock In Units", value: formatUnits(report.inventory.movement.restocked_units) },
    { label: "Stock Out Units", value: formatUnits(report.inventory.movement.sold_units) },
    { label: "Stock Adj. Units", value: formatUnits(report.inventory.movement.adjustment_net_units) },
  ];
}

function getShopDocumentLines() {
  const settings = getRuntimeSiteSettings();
  const contactLine = [
    settings.phone_number ? `Phone: ${settings.phone_number}` : null,
    settings.address ? `Address: ${settings.address}` : null,
  ].filter(Boolean).join(" | ");

  return {
    settings,
    contactLine,
  };
}

async function fetchRangeSummary(from: string, to: string, groupBy: GroupBy) {
  const params = new URLSearchParams({ from, to, groupBy });

  const res = await fetch(`/api/reports/range?${params.toString()}`, {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<SummaryResponse> | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load special report");
  }

  return payload.data;
}

function buildPrintableHtml(
  report: SummaryResponse,
  title: string,
  from: string,
  to: string,
  groupBy: GroupBy,
  generatedAt: string,
) {
  const { settings, contactLine } = getShopDocumentLines();
  const summaryRows = getSummaryItems(report)
    .map((item) => `<tr><td>${item.label}</td><td>${item.value}</td></tr>`)
    .join("");

  const trendRows = report.trend
    .map(
      (row) => `<tr>
<td>${formatSpecialPeriod(row.period, groupBy)}</td>
<td style="text-align:right">${row.sale_count}</td>
<td style="text-align:right">${formatTaka(row.sales_total)}</td>
<td style="text-align:right">${formatTaka(row.due_total)}</td>
<td style="text-align:right">${formatTaka(row.due_collected)}</td>
<td style="text-align:right">${formatTaka(row.expense_total)}</td>
<td style="text-align:right">${formatTaka(row.gross_profit)}</td>
<td style="text-align:right">${formatTaka(row.net_profit)}</td>
</tr>`,
    )
    .join("");

  const stockRows = report.stock_changes
    .map(
      (row) => `<tr>
<td>${row.last_changed_at}</td>
<td>${row.product_name}</td>
<td style="text-align:right">${row.entry_count}</td>
<td style="text-align:right">${row.restocked_units}</td>
<td style="text-align:right">${row.sold_units}</td>
<td style="text-align:right">${row.adjustment_units}</td>
<td style="text-align:right">${row.net_change_units}</td>
</tr>`,
    )
    .join("");

  const expenseRows = report.expense_breakdown
    .map(
      (row) => `<tr>
<td>${row.category}</td>
<td style="text-align:right">${row.expense_count}</td>
<td style="text-align:right">${formatTaka(row.total_amount)}</td>
</tr>`,
    )
    .join("");

  const dueRows = report.top_due_customers
    .map(
      (row) => `<tr>
<td>${row.name || "Walk-in"}</td>
<td>${row.phone}</td>
<td style="text-align:right">${formatTaka(row.due)}</td>
</tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${settings.site_name} ${title}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #0f172a; margin: 20px; }
      h1 { margin: 0 0 8px; font-size: 22px; }
      h2 { margin: 18px 0 8px; font-size: 16px; }
      table { width: 100%; border-collapse: collapse; margin-top: 6px; }
      th, td { border: 1px solid #dbe2ea; padding: 6px 8px; font-size: 11px; }
      th { text-align: left; background: #f8fafc; }
      .meta { color: #475569; font-size: 12px; }
    </style>
  </head>
  <body>
    <h1>${settings.site_name}</h1>
    ${contactLine ? `<p class="meta">${contactLine}</p>` : ""}
    <h2>${title}</h2>
    <p class="meta">Range: ${formatDate(from)} to ${formatDate(to)} | Group By: ${groupBy} | Generated: ${formatDateTime(generatedAt)}</p>

    <h2>Summary</h2>
    <table><tbody>${summaryRows}</tbody></table>

    <h2>Trend</h2>
    <table><thead><tr><th>Period</th><th>Sell</th><th>Sales Total</th><th>Total Due</th><th>Due Collected</th><th>Total Expenses</th><th>Gross Profit</th><th>Net Profit</th></tr></thead><tbody>${trendRows || "<tr><td colspan=\"8\">No data</td></tr>"}</tbody></table>

    <h2>Stock Changes</h2>
    <table><thead><tr><th>Last Changed</th><th>Product</th><th>Entries</th><th>Restocked</th><th>Sold</th><th>Adjusted</th><th>Net Change</th></tr></thead><tbody>${stockRows || "<tr><td colspan=\"7\">No data</td></tr>"}</tbody></table>

    <h2>Expense Breakdown</h2>
    <table><thead><tr><th>Category</th><th>Entries</th><th>Total Amount</th></tr></thead><tbody>${expenseRows || "<tr><td colspan=\"3\">No data</td></tr>"}</tbody></table>

    <h2>Top Due Customers</h2>
    <table><thead><tr><th>Customer</th><th>Phone</th><th>Due</th></tr></thead><tbody>${dueRows || "<tr><td colspan=\"3\">No data</td></tr>"}</tbody></table>
  </body>
</html>`;
}

export default function SpecialPreviewPage() {
  const searchParams = useSearchParams();

  const key = (searchParams.get("key") ?? "custom") as SpecialReportCardKey;
  const label = searchParams.get("label") ?? labelByKey[key] ?? "Special Range Report";
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const groupBy = (searchParams.get("groupBy") === "month" ? "month" : "day") as GroupBy;
  const generatedAt = searchParams.get("generatedAt") ?? new Date().toISOString();

  const isValidRange = isIsoDate(from) && isIsoDate(to) && String(from) <= String(to);

  const [trendPage, setTrendPage] = useState(1);
  const [stockPage, setStockPage] = useState(1);
  const [expensePage, setExpensePage] = useState(1);
  const [duePage, setDuePage] = useState(1);
  const [trendPageSize, setTrendPageSize] = useState(20);
  const [stockPageSize, setStockPageSize] = useState(20);
  const [expensePageSize, setExpensePageSize] = useState(10);
  const [duePageSize, setDuePageSize] = useState(10);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["special-preview-range", from, to, groupBy],
    queryFn: () => fetchRangeSummary(from!, to!, groupBy),
    enabled: Boolean(isValidRange),
  });

  const trendPager = useMemo(
    () => paginateRows(data?.trend ?? [], trendPage, trendPageSize),
    [data?.trend, trendPage, trendPageSize],
  );

  const stockPager = useMemo(
    () => paginateRows(data?.stock_changes ?? [], stockPage, stockPageSize),
    [data?.stock_changes, stockPage, stockPageSize],
  );

  const expensePager = useMemo(
    () => paginateRows(data?.expense_breakdown ?? [], expensePage, expensePageSize),
    [data?.expense_breakdown, expensePage, expensePageSize],
  );

  const duePager = useMemo(
    () => paginateRows(data?.top_due_customers ?? [], duePage, duePageSize),
    [data?.top_due_customers, duePage, duePageSize],
  );

  function handlePrint() {
    if (!data || !from || !to) {
      toast.error("Report not ready");
      return;
    }

    const popup = window.open("", "_blank", "width=1200,height=900");
    if (!popup) {
      toast.error("Popup blocked. Please allow popups.");
      return;
    }

    popup.document.open();
    popup.document.write(buildPrintableHtml(data, label, from, to, groupBy, generatedAt));
    popup.document.close();
    popup.focus();
    popup.print();
  }

  async function handleExportPdf() {
    if (!data || !from || !to) {
      toast.error("Report not ready");
      return;
    }

    try {
      const { settings, contactLine } = getShopDocumentLines();
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);

      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(14);
      doc.text(`${settings.site_name} - ${label}`.replace(/৳/g, "Tk "), 40, 34);
      doc.setFontSize(10);
      let headerY = 50;
      if (contactLine) {
        doc.text(contactLine.replace(/৳/g, "Tk "), 40, headerY);
        headerY += 14;
      }
      doc.text(`Range: ${formatDate(from)} to ${formatDate(to)} (${groupBy})`, 40, headerY);
      headerY += 16;
      doc.text(`Generated: ${formatDateTime(generatedAt)}`.replace(/৳/g, "Tk "), 40, headerY);

      autoTable(doc, {
        startY: headerY + 16,
        head: [["Metric", "Value"]],
        body: getSummaryItems(data).map((item) => [item.label, item.value.replace(/৳/g, "Tk ")]),
        styles: { font: "helvetica", fontSize: 8.2, cellPadding: 4 },
        headStyles: { fillColor: [15, 23, 42] },
        theme: "grid",
      });

      let y = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 240;

      autoTable(doc, {
        startY: y + 12,
        head: [["Period", "Sell", "Sales Total", "Total Due", "Due Collected", "Total Expenses", "Gross Profit", "Net Profit"]],
        body: data.trend.map((row) => [
          formatSpecialPeriod(row.period, groupBy),
          String(row.sale_count),
          formatTaka(row.sales_total).replace(/৳/g, "Tk "),
          formatTaka(row.due_total).replace(/৳/g, "Tk "),
          formatTaka(row.due_collected).replace(/৳/g, "Tk "),
          formatTaka(row.expense_total).replace(/৳/g, "Tk "),
          formatTaka(row.gross_profit).replace(/৳/g, "Tk "),
          formatTaka(row.net_profit).replace(/৳/g, "Tk "),
        ]),
        styles: { font: "helvetica", fontSize: 7.2, cellPadding: 3 },
        headStyles: { fillColor: [30, 64, 175] },
        theme: "grid",
      });

      y = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 80;

      autoTable(doc, {
        startY: y + 12,
        head: [["Last Changed", "Product", "Entries", "Restocked", "Sold", "Adjusted", "Net Change"]],
        body: data.stock_changes.map((row) => [
          row.last_changed_at,
          row.product_name,
          String(row.entry_count),
          String(row.restocked_units),
          String(row.sold_units),
          String(row.adjustment_units),
          String(row.net_change_units),
        ]),
        styles: { font: "helvetica", fontSize: 7.2, cellPadding: 3 },
        headStyles: { fillColor: [217, 119, 6] },
        theme: "grid",
      });

      doc.save(`special-report-${key}-${from}-to-${to}.pdf`);
      toast.success("Special PDF exported");
    } catch {
      toast.error("Failed to export special PDF");
    }
  }

  function handleExportExcel() {
    if (!data || !from || !to) {
      toast.error("Report not ready");
      return;
    }

    try {
      const { settings } = getShopDocumentLines();
      const workbook = XLSX.utils.book_new();
      const summarySheet = XLSX.utils.json_to_sheet(
        [
          { metric: "Shop Name", value: settings.site_name },
          { metric: "Short Name", value: settings.short_name },
          { metric: "Phone Number", value: settings.phone_number ?? "-" },
          { metric: "Address", value: settings.address ?? "-" },
          ...getSummaryItems(data).map((item) => ({ metric: item.label, value: item.value })),
        ],
      );
      const trendSheet = XLSX.utils.json_to_sheet(
        data.trend.map((row) => ({
          period: formatSpecialPeriod(row.period, groupBy),
          sell: row.sale_count,
          sales_total: row.sales_total,
          total_due: row.due_total,
          due_collected: row.due_collected,
          total_expenses: row.expense_total,
          gross_profit: row.gross_profit,
          net_profit: row.net_profit,
        })),
      );
      const stockSheet = XLSX.utils.json_to_sheet(data.stock_changes);
      const expenseSheet = XLSX.utils.json_to_sheet(data.expense_breakdown);
      const dueSheet = XLSX.utils.json_to_sheet(data.top_due_customers);

      XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
      XLSX.utils.book_append_sheet(workbook, trendSheet, "Trend");
      XLSX.utils.book_append_sheet(workbook, stockSheet, "Stock Changes");
      XLSX.utils.book_append_sheet(workbook, expenseSheet, "Expense Breakdown");
      XLSX.utils.book_append_sheet(workbook, dueSheet, "Top Due Customers");

      XLSX.writeFile(workbook, `special-report-${key}-${from}-to-${to}.xlsx`);
      toast.success("Special Excel exported");
    } catch {
      toast.error("Failed to export special Excel");
    }
  }

  if (!isValidRange || !from || !to) {
    return (
      <Card className="p-6 text-sm text-red-600">
        Invalid report range. Please go back and open the special report again.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{label}</h2>
          <p className="text-sm text-slate-500">
            Range: {formatDate(from)} to {formatDate(to)} | Group by: {groupBy} | Generated: {formatDateTime(generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handlePrint}>Print</Button>
          <Button variant="secondary" onClick={handleExportPdf}>Export PDF</Button>
          <Button variant="secondary" onClick={handleExportExcel}>Export Excel</Button>
        </div>
      </div>

      {isLoading ? <Card className="p-5 text-sm text-slate-500">Generating special report...</Card> : null}
      {isError ? <Card className="p-5 text-sm text-red-600">Failed to load special report.</Card> : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Sell" value={String(data.summary.sale_count)} accent="blue" />
            <StatCard title="Sales Total" value={formatTaka(data.summary.sales_total)} accent="green" />
            <StatCard title="Gross Profit" value={formatTaka(data.summary.gross_profit)} accent="green" />
            <StatCard title="Net Profit" value={formatTaka(data.summary.net_profit)} accent={data.summary.net_profit >= 0 ? "green" : "red"} />
          </div>

          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3"><h3 className="text-sm font-semibold text-slate-900">Detailed Summary</h3></div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 text-left">Metric</th><th className="px-3 py-2 text-right">Value</th></tr></thead>
                <tbody>
                  {getSummaryItems(data).map((item) => (
                    <tr key={item.label} className="border-t border-slate-100">
                      <td className="px-3 py-2">{item.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{item.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3"><h3 className="text-sm font-semibold text-slate-900">Trend</h3></div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Period</th>
                    <th className="px-3 py-2 text-right">Sell</th>
                    <th className="px-3 py-2 text-right">Sales Total</th>
                    <th className="px-3 py-2 text-right">Total Due</th>
                    <th className="px-3 py-2 text-right">Due Collected</th>
                    <th className="px-3 py-2 text-right">Total Expenses</th>
                    <th className="px-3 py-2 text-right">Gross Profit</th>
                    <th className="px-3 py-2 text-right">Net Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {trendPager.rows.length === 0 ? (
                    <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={8}>No trend data.</td></tr>
                  ) : (
                    trendPager.rows.map((row) => (
                      <tr key={row.period} className="border-t border-slate-100">
                        <td className="px-3 py-2">{formatSpecialPeriod(row.period, groupBy)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.sale_count}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatTaka(row.sales_total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatTaka(row.due_total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatTaka(row.due_collected)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatTaka(row.expense_total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatTaka(row.gross_profit)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatTaka(row.net_profit)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
              <span>Showing {trendPager.rows.length} of {trendPager.totalCount}</span>
              <div className="flex items-center gap-2">
                <select className="h-8 rounded border border-slate-300 px-2" value={String(trendPageSize)} onChange={(e) => { setTrendPageSize(Number(e.target.value)); setTrendPage(1); }}>
                  <option value="10">10</option><option value="20">20</option><option value="50">50</option>
                </select>
                <Button size="sm" variant="ghost" disabled={trendPager.page <= 1} onClick={() => setTrendPage((p) => Math.max(1, p - 1))}>Previous</Button>
                <span>Page {trendPager.page} of {trendPager.totalPages}</span>
                <Button size="sm" variant="ghost" disabled={trendPager.page >= trendPager.totalPages} onClick={() => setTrendPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3"><h3 className="text-sm font-semibold text-slate-900">Stock Changes</h3></div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Last Changed</th>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-right">Entries</th>
                    <th className="px-3 py-2 text-right">Restocked</th>
                    <th className="px-3 py-2 text-right">Sold</th>
                    <th className="px-3 py-2 text-right">Adjusted</th>
                    <th className="px-3 py-2 text-right">Net Change</th>
                  </tr>
                </thead>
                <tbody>
                  {stockPager.rows.length === 0 ? (
                    <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={7}>No stock change data.</td></tr>
                  ) : (
                    stockPager.rows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">{row.last_changed_at}</td>
                        <td className="px-3 py-2">{row.product_name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.entry_count}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.restocked_units}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.sold_units}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.adjustment_units}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.net_change_units}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
              <span>Showing {stockPager.rows.length} of {stockPager.totalCount}</span>
              <div className="flex items-center gap-2">
                <select className="h-8 rounded border border-slate-300 px-2" value={String(stockPageSize)} onChange={(e) => { setStockPageSize(Number(e.target.value)); setStockPage(1); }}>
                  <option value="10">10</option><option value="20">20</option><option value="50">50</option>
                </select>
                <Button size="sm" variant="ghost" disabled={stockPager.page <= 1} onClick={() => setStockPage((p) => Math.max(1, p - 1))}>Previous</Button>
                <span>Page {stockPager.page} of {stockPager.totalPages}</span>
                <Button size="sm" variant="ghost" disabled={stockPager.page >= stockPager.totalPages} onClick={() => setStockPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="overflow-hidden">
              <div className="border-b border-slate-200 px-4 py-3"><h3 className="text-sm font-semibold text-slate-900">Expense Breakdown</h3></div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-right">Entries</th><th className="px-3 py-2 text-right">Total Amount</th></tr></thead>
                  <tbody>
                    {expensePager.rows.length === 0 ? (
                      <tr><td className="px-3 py-6 text-center text-slate-500" colSpan={3}>No expense data.</td></tr>
                    ) : (
                      expensePager.rows.map((row) => (
                        <tr key={row.category} className="border-t border-slate-100">
                          <td className="px-3 py-2">{row.category}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.expense_count}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatTaka(row.total_amount)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
                <span>Showing {expensePager.rows.length} of {expensePager.totalCount}</span>
                <div className="flex items-center gap-2">
                  <select className="h-8 rounded border border-slate-300 px-2" value={String(expensePageSize)} onChange={(e) => { setExpensePageSize(Number(e.target.value)); setExpensePage(1); }}>
                    <option value="5">5</option><option value="10">10</option><option value="20">20</option>
                  </select>
                  <Button size="sm" variant="ghost" disabled={expensePager.page <= 1} onClick={() => setExpensePage((p) => Math.max(1, p - 1))}>Previous</Button>
                  <span>Page {expensePager.page} of {expensePager.totalPages}</span>
                  <Button size="sm" variant="ghost" disabled={expensePager.page >= expensePager.totalPages} onClick={() => setExpensePage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-slate-200 px-4 py-3"><h3 className="text-sm font-semibold text-slate-900">Top Due Customers</h3></div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 text-left">Customer</th><th className="px-3 py-2 text-left">Phone</th><th className="px-3 py-2 text-right">Due</th></tr></thead>
                  <tbody>
                    {duePager.rows.length === 0 ? (
                      <tr><td className="px-3 py-6 text-center text-slate-500" colSpan={3}>No due customer data.</td></tr>
                    ) : (
                      duePager.rows.map((row) => (
                        <tr key={row.id} className="border-t border-slate-100">
                          <td className="px-3 py-2">{row.name || "Walk-in"}</td>
                          <td className="px-3 py-2">{row.phone}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatTaka(row.due)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
                <span>Showing {duePager.rows.length} of {duePager.totalCount}</span>
                <div className="flex items-center gap-2">
                  <select className="h-8 rounded border border-slate-300 px-2" value={String(duePageSize)} onChange={(e) => { setDuePageSize(Number(e.target.value)); setDuePage(1); }}>
                    <option value="5">5</option><option value="10">10</option><option value="20">20</option>
                  </select>
                  <Button size="sm" variant="ghost" disabled={duePager.page <= 1} onClick={() => setDuePage((p) => Math.max(1, p - 1))}>Previous</Button>
                  <span>Page {duePager.page} of {duePager.totalPages}</span>
                  <Button size="sm" variant="ghost" disabled={duePager.page >= duePager.totalPages} onClick={() => setDuePage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
