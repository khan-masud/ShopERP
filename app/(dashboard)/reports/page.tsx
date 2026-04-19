"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { StatCard } from "@/components/ui/StatCard";
import { formatDate, formatDateTime, formatTaka } from "@/lib/utils";

type GroupBy = "day" | "month";
type ReportTemplateKey = "selling" | "due" | "stock" | "expense" | "customer" | "profit";
type RangePreset = "today" | "yesterday" | "last_week" | "last_month" | "last_year" | "alltime" | "custom";

type ReportValue = string | number | null;
type ReportRow = Record<string, ReportValue>;

type ReportTable = {
  key: string;
  title: string;
  columns: string[];
  rows: ReportRow[];
};

type PaginationPayload = {
  page: number;
  page_size: number;
  total_rows: number;
  total_pages: number;
  has_prev: boolean;
  has_next: boolean;
};

type TemplateReportResponse = {
  template: ReportTemplateKey;
  range: {
    from: string;
    to: string;
    group_by: GroupBy;
  };
  summary: {
    sale_count: number;
    sales_total: number;
    due_total: number;
    paid_total: number;
    due_collected: number;
    expenses_total: number;
    gross_profit: number;
    net_profit: number;
    outstanding_due: number;
    today_due_amount: number;
    today_due_customers: number;
    total_customers: number;
    due_customers: number;
    stock_in_units: number;
    stock_out_units: number;
    stock_adjustment_units: number;
  };
  table: ReportTable;
  extra_tables: ReportTable[];
  pagination: PaginationPayload;
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
    outstanding_due: number;
    sales_amount_collected: number;
    net_sales_amount: number;
    total_customers: number;
    due_customers_count: number;
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
  meta: {
    points: number;
    total_points: number;
    page: number;
    page_size: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
};

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

type SpecialReportSelection = {
  key: SpecialReportCardKey;
  label: string;
  from: string;
  to: string;
  groupBy: GroupBy;
};

type ApiSuccess<T> = {
  success: true;
  data: T;
};

type ApiErrorPayload = {
  success: false;
  message?: string;
};

type ReportFilters = {
  template: ReportTemplateKey;
  preset: RangePreset;
  from: string;
  to: string;
  groupBy: GroupBy;
  pageSize: number;
};

const templateLabels: Record<ReportTemplateKey, string> = {
  selling: "Selling Report",
  due: "Due Report",
  stock: "Stock Report",
  expense: "Expense Report",
  customer: "Customer Report",
  profit: "Profit Report",
};

const presetLabels: Record<RangePreset, string> = {
  today: "Daily",
  yesterday: "Yesterday",
  last_week: "Last Week",
  last_month: "Last Month",
  last_year: "Last Year",
  alltime: "All Time",
  custom: "Custom",
};

function formatInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getYesterday(date: Date) {
  const previous = new Date(date);
  previous.setDate(previous.getDate() - 1);
  return previous;
}

function getRollingRange(reference: Date, totalDays: number) {
  const safeDays = Math.max(1, Math.floor(totalDays));
  const end = new Date(reference);
  const start = new Date(reference);
  start.setDate(start.getDate() - (safeDays - 1));

  return {
    from: formatInputDate(start),
    to: formatInputDate(end),
  };
}

function getDefaultFilters(): ReportFilters {
  const today = formatInputDate(new Date());

  return {
    template: "selling",
    preset: "today",
    from: today,
    to: today,
    groupBy: "day",
    pageSize: 20,
  };
}

function getPresetRange(preset: RangePreset) {
  const now = new Date();
  const today = formatInputDate(now);

  if (preset === "today") {
    return {
      from: today,
      to: today,
      groupBy: "day" as GroupBy,
    };
  }

  if (preset === "yesterday") {
    const yesterday = formatInputDate(getYesterday(now));
    return {
      from: yesterday,
      to: yesterday,
      groupBy: "day" as GroupBy,
    };
  }

  if (preset === "last_week") {
    const range = getRollingRange(now, 7);
    return {
      ...range,
      groupBy: "day" as GroupBy,
    };
  }

  if (preset === "last_month") {
    const range = getRollingRange(now, 30);
    return {
      ...range,
      groupBy: "day" as GroupBy,
    };
  }

  if (preset === "last_year") {
    const range = getRollingRange(now, 365);
    return {
      ...range,
      groupBy: "month" as GroupBy,
    };
  }

  if (preset === "alltime") {
    return {
      from: "2000-01-01",
      to: today,
      groupBy: "month" as GroupBy,
    };
  }

  return {
    from: today,
    to: today,
    groupBy: "day" as GroupBy,
  };
}

function buildSpecialReportSelection(
  key: SpecialReportCardKey,
  customFrom: string,
  customTo: string,
  customGroupBy: GroupBy,
): SpecialReportSelection {
  const now = new Date();
  const today = formatInputDate(now);
  const yesterday = formatInputDate(getYesterday(now));
  const lastWeek = getRollingRange(now, 7);
  const last15Days = getRollingRange(now, 15);
  const lastMonth = getRollingRange(now, 30);
  const last3Months = getRollingRange(now, 90);
  const last6Months = getRollingRange(now, 180);
  const last12Months = getRollingRange(now, 365);

  if (key === "daily") {
    return { key, label: "Daily Report", from: today, to: today, groupBy: "day" };
  }

  if (key === "previous_day") {
    return { key, label: "Previous Day Report", from: yesterday, to: yesterday, groupBy: "day" };
  }

  if (key === "last_week") {
    return { key, label: "Last Week Report", from: lastWeek.from, to: lastWeek.to, groupBy: "day" };
  }

  if (key === "last_15_days") {
    return { key, label: "Last 15 Days Report", from: last15Days.from, to: last15Days.to, groupBy: "day" };
  }

  if (key === "last_month") {
    return { key, label: "Last Month Report", from: lastMonth.from, to: lastMonth.to, groupBy: "day" };
  }

  if (key === "last_3_month") {
    return { key, label: "Last 3 Month Report", from: last3Months.from, to: last3Months.to, groupBy: "month" };
  }

  if (key === "last_6_month") {
    return { key, label: "Last 6 Month Report", from: last6Months.from, to: last6Months.to, groupBy: "month" };
  }

  if (key === "last_12_month") {
    return { key, label: "Last 12 Month Report", from: last12Months.from, to: last12Months.to, groupBy: "month" };
  }

  return {
    key,
    label: "Custom Range Report",
    from: customFrom,
    to: customTo,
    groupBy: customGroupBy,
  };
}

function validateDateInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseDisplayDateInput(value: string) {
  const normalized = value.trim().replace(/\//g, "-");
  const match = normalized.match(/^(\d{2})-(\d{2})-(\d{4})$/);

  if (!match) {
    return null;
  }

  const day = match[1];
  const month = match[2];
  const year = match[3];
  const iso = `${year}-${month}-${day}`;

  return validateDateInput(iso) ? iso : null;
}

function isDateRangeValid(from: string, to: string) {
  return validateDateInput(from) && validateDateInput(to) && from <= to;
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

function isNumericLike(value: ReportValue) {
  if (typeof value === "number") {
    return true;
  }

  if (typeof value === "string") {
    return /^-?\d+(\.\d+)?$/.test(value.trim());
  }

  return false;
}

function maybeMoney(value: ReportValue) {
  if (!isNumericLike(value)) {
    return null;
  }

  return Number(value);
}

function formatMonthValue(value: ReportValue) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return raw;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return raw;
  }

  const date = new Date(Date.UTC(year, month - 1, 1));
  const shortMonth = new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC",
  }).format(date);

  return `${shortMonth}-${year}`;
}

function formatCellValue(column: string, value: ReportValue) {
  const raw = value ?? "";

  if (column.toLowerCase().includes("phone")) {
    return String(raw);
  }

  if (column.toLowerCase().includes("month")) {
    return formatMonthValue(raw);
  }

  if (column.toLowerCase().includes("margin")) {
    return `${toNumber(raw).toFixed(2)}%`;
  }

  const moneyValue = maybeMoney(raw);
  if (
    moneyValue !== null &&
    (column.toLowerCase().includes("amount") ||
      column.toLowerCase().includes("profit") ||
      column.toLowerCase().includes("sales") ||
      column.toLowerCase().includes("due") ||
      column.toLowerCase().includes("paid") ||
      column.toLowerCase().includes("expense"))
  ) {
    return formatTaka(moneyValue);
  }

  if (moneyValue !== null) {
    return formatUnits(moneyValue);
  }

  return String(raw);
}

function formatCellValueForPdf(column: string, value: ReportValue) {
  const view = formatCellValue(column, value);
  return view.replace(/৳/g, "Tk ");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getSummaryItemsForTemplate(template: ReportTemplateKey, summary: TemplateReportResponse["summary"]) {
  switch (template) {
    case "selling":
      return [
        { label: "Sell", value: String(summary.sale_count), accent: "blue" as const },
        { label: "Sales Total", value: formatTaka(summary.sales_total), accent: "green" as const },
        { label: "Paid Total", value: formatTaka(summary.paid_total), accent: "blue" as const },
        { label: "Due Total", value: formatTaka(summary.due_total), accent: "orange" as const },
      ];
    case "due":
      return [
        { label: "Due Customer (Range)", value: String(summary.today_due_customers), accent: "blue" as const },
        { label: "Total Due Customer", value: String(summary.due_customers), accent: "orange" as const },
        { label: "Due Amount (Range)", value: formatTaka(summary.today_due_amount), accent: "orange" as const },
        { label: "Total Due Amount", value: formatTaka(summary.outstanding_due), accent: "red" as const },
      ];
    case "stock":
      return [
        { label: "Stock In Units", value: formatUnits(summary.stock_in_units), accent: "green" as const },
        { label: "Stock Out Units", value: formatUnits(summary.stock_out_units), accent: "red" as const },
        { label: "Stock Adj. Units", value: formatUnits(summary.stock_adjustment_units), accent: "orange" as const },
      ];
    case "expense":
      return [
        { label: "Total Expenses", value: formatTaka(summary.expenses_total), accent: "red" as const },
      ];
    case "customer":
      return [
        { label: "Total Customers", value: String(summary.total_customers), accent: "blue" as const },
        { label: "Total Sell Amount", value: formatTaka(summary.sales_total), accent: "green" as const },
        { label: "Due Customers", value: String(summary.due_customers), accent: "orange" as const },
        { label: "Total Due", value: formatTaka(summary.outstanding_due), accent: "red" as const },
      ];
    case "profit":
      return [
        { label: "Sales Total", value: formatTaka(summary.sales_total), accent: "blue" as const },
        { label: "Total Expenses", value: formatTaka(summary.expenses_total), accent: "red" as const },
        { label: "Gross Profit", value: formatTaka(summary.gross_profit), accent: "green" as const },
        { label: "Net Profit", value: formatTaka(summary.net_profit), accent: (summary.net_profit >= 0 ? "green" : "red") as const },
      ];
    default:
      return [];
  }
}

async function fetchTemplateReport(filters: ReportFilters, page: number) {
  const params = new URLSearchParams({
    template: filters.template,
    from: filters.from,
    to: filters.to,
    groupBy: filters.groupBy,
    page: String(page),
    pageSize: String(filters.pageSize),
  });

  const res = await fetch(`/api/reports/template?${params.toString()}`, {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<TemplateReportResponse> | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load report template");
  }

  return payload.data;
}

async function fetchRangeSummary(from: string, to: string, groupBy: GroupBy) {
  const params = new URLSearchParams({
    from,
    to,
    groupBy,
  });

  const res = await fetch(`/api/reports/range?${params.toString()}`, {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<SummaryResponse> | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load summary report");
  }

  return payload.data;
}

function buildPrintableHtml(
  report: TemplateReportResponse,
  filters: ReportFilters,
  generatedAt: string,
) {
  const mainHeaderCells = report.table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const mainRows = report.table.rows
    .map((row) => {
      const cells = report.table.columns
        .map((column) => `<td>${escapeHtml(formatCellValue(column, row[column] ?? ""))}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  const extraTables = report.extra_tables
    .map((table) => {
      const headerCells = table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
      const rows = table.rows
        .map((row) => {
          const cells = table.columns
            .map((column) => `<td>${escapeHtml(formatCellValue(column, row[column] ?? ""))}</td>`)
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");

      return `
      <h3>${escapeHtml(table.title)}</h3>
      <table>
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      `;
    })
    .join("");

  const summaryRows = getSummaryItemsForTemplate(filters.template, report.summary)
    .map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.value)}</td></tr>`)
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>ShopERP ${templateLabels[filters.template]}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #0f172a; margin: 22px; }
      h1 { margin: 0 0 6px; font-size: 21px; }
      h2 { margin: 14px 0 8px; font-size: 15px; }
      h3 { margin: 16px 0 8px; font-size: 13px; }
      table { width: 100%; border-collapse: collapse; margin-top: 6px; }
      th, td { border: 1px solid #dbe2ea; padding: 6px 8px; font-size: 11px; }
      th { text-align: left; background: #f8fafc; }
      .meta { color: #475569; font-size: 12px; margin-bottom: 8px; }
    </style>
  </head>
  <body>
    <h1>ShopERP ${escapeHtml(templateLabels[filters.template])}</h1>
    <p class="meta">Range: ${escapeHtml(formatDate(filters.from))} to ${escapeHtml(formatDate(filters.to))} | Group By: ${escapeHtml(filters.groupBy)} | Generated: ${escapeHtml(formatDateTime(generatedAt))}</p>

    <h2>Main Summary</h2>
    <table>
      <tbody>${summaryRows}</tbody>
    </table>

    <h2>${escapeHtml(report.table.title)}</h2>
    <table>
      <thead><tr>${mainHeaderCells}</tr></thead>
      <tbody>${mainRows}</tbody>
    </table>

    ${extraTables}
  </body>
</html>`;
}

async function exportPdf(
  report: TemplateReportResponse,
  filters: ReportFilters,
  generatedAt: string,
) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFont("helvetica", "normal");

  doc.setFontSize(14);
  doc.text(`ShopERP ${templateLabels[filters.template]}`.replace(/৳/g, "Tk "), 40, 34);
  doc.setFontSize(10);
  doc.text(`Range: ${formatDate(filters.from)} to ${formatDate(filters.to)} (${filters.groupBy})`, 40, 52);
  doc.text(`Generated: ${formatDateTime(generatedAt)}`.replace(/৳/g, "Tk "), 40, 68);

  const summaryBody = getSummaryItemsForTemplate(filters.template, report.summary).map((item) => [
    item.label,
    item.value.replace(/৳/g, "Tk "),
  ]);

  autoTable(doc, {
    startY: 84,
    head: [["Metric", "Value"]],
    body: summaryBody,
    styles: { font: "helvetica", fontSize: 8.4, overflow: "linebreak", cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42] },
    theme: "grid",
  });

  let cursorY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 240;

  autoTable(doc, {
    startY: cursorY + 14,
    head: [report.table.columns],
    body: report.table.rows.map((row) => report.table.columns.map((column) => formatCellValueForPdf(column, row[column] ?? ""))),
    styles: { font: "helvetica", fontSize: 7.8, overflow: "linebreak", cellPadding: 3.2 },
    headStyles: { fillColor: [30, 64, 175] },
    theme: "grid",
  });

  cursorY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cursorY + 70;

  for (const table of report.extra_tables) {
    autoTable(doc, {
      startY: cursorY + 12,
      head: [table.columns],
      body: table.rows.map((row) => table.columns.map((column) => formatCellValueForPdf(column, row[column] ?? ""))),
      styles: { font: "helvetica", fontSize: 7.4, overflow: "linebreak", cellPadding: 3 },
      headStyles: { fillColor: [217, 119, 6] },
      theme: "grid",
    });

    cursorY =
      (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cursorY + 65;
  }

  doc.save(`report-${filters.template}-${filters.from}-to-${filters.to}.pdf`);
}

function exportExcel(
  report: TemplateReportResponse,
  filters: ReportFilters,
) {
  const workbook = XLSX.utils.book_new();

  const dynamicSummary = getSummaryItemsForTemplate(filters.template, report.summary).map(
    (item) => ({ metric: item.label, value: item.value })
  );

  const summarySheet = XLSX.utils.json_to_sheet([
    { metric: "Template", value: templateLabels[filters.template] },
    { metric: "From", value: formatDate(filters.from) },
    { metric: "To", value: formatDate(filters.to) },
    { metric: "Group By", value: filters.groupBy },
    ...dynamicSummary,
  ]);

  const mainRows = report.table.rows.map((row) => {
    const normalized: Record<string, ReportValue> = {};
    for (const column of report.table.columns) {
      const value = row[column] ?? "";
      normalized[column] = column.toLowerCase().includes("month")
        ? formatMonthValue(value)
        : value;
    }
    return normalized;
  });

  const mainSheet = XLSX.utils.json_to_sheet(mainRows);

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, mainSheet, report.table.title.slice(0, 31));

  for (const table of report.extra_tables) {
    const rows = table.rows.map((row) => {
      const normalized: Record<string, ReportValue> = {};
      for (const column of table.columns) {
        const value = row[column] ?? "";
        normalized[column] = column.toLowerCase().includes("month")
          ? formatMonthValue(value)
          : value;
      }
      return normalized;
    });

    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, table.title.slice(0, 31));
  }

  XLSX.writeFile(workbook, `report-${filters.template}-${filters.from}-to-${filters.to}.xlsx`);
}

function formatSpecialPeriod(period: string, groupBy: GroupBy) {
  if (groupBy === "month") {
    return formatMonthValue(period);
  }

  return formatDate(period);
}

function getSpecialSummaryItems(report: SummaryResponse) {
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

function buildSpecialPrintableHtml(
  report: SummaryResponse,
  selection: SpecialReportSelection,
  generatedAt: string,
) {
  const summaryRows = getSpecialSummaryItems(report)
    .map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.value)}</td></tr>`)
    .join("");

  const trendRows = report.trend
    .map(
      (row) => `<tr>
        <td>${escapeHtml(formatSpecialPeriod(row.period, selection.groupBy))}</td>
        <td style="text-align:right">${row.sale_count}</td>
        <td style="text-align:right">${escapeHtml(formatTaka(row.sales_total))}</td>
        <td style="text-align:right">${escapeHtml(formatTaka(row.due_total))}</td>
        <td style="text-align:right">${escapeHtml(formatTaka(row.due_collected))}</td>
        <td style="text-align:right">${escapeHtml(formatTaka(row.expense_total))}</td>
        <td style="text-align:right">${escapeHtml(formatTaka(row.gross_profit))}</td>
        <td style="text-align:right">${escapeHtml(formatTaka(row.net_profit))}</td>
      </tr>`,
    )
    .join("");

  const expenseRows = report.expense_breakdown
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.category)}</td>
        <td style="text-align:right">${row.expense_count}</td>
        <td style="text-align:right">${escapeHtml(formatTaka(row.total_amount))}</td>
      </tr>`,
    )
    .join("");

  const dueRows = report.top_due_customers
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.name || "Walk-in")}</td>
        <td>${escapeHtml(row.phone)}</td>
        <td style="text-align:right">${escapeHtml(formatTaka(row.due))}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>ShopERP ${escapeHtml(selection.label)}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #0f172a; margin: 22px; }
      h1 { margin: 0 0 6px; font-size: 21px; }
      h2 { margin: 14px 0 8px; font-size: 15px; }
      table { width: 100%; border-collapse: collapse; margin-top: 6px; }
      th, td { border: 1px solid #dbe2ea; padding: 6px 8px; font-size: 11px; }
      th { text-align: left; background: #f8fafc; }
      .meta { color: #475569; font-size: 12px; margin-bottom: 8px; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(selection.label)}</h1>
    <p class="meta">Range: ${escapeHtml(formatDate(selection.from))} to ${escapeHtml(formatDate(selection.to))} | Group By: ${escapeHtml(selection.groupBy)} | Generated: ${escapeHtml(formatDateTime(generatedAt))}</p>

    <h2>Summary</h2>
    <table><tbody>${summaryRows}</tbody></table>

    <h2>Trend</h2>
    <table>
      <thead>
        <tr><th>Period</th><th>Sell</th><th>Sales Total</th><th>Total Due</th><th>Due Collected</th><th>Total Expenses</th><th>Gross Profit</th><th>Net Profit</th></tr>
      </thead>
      <tbody>${trendRows || "<tr><td colspan=\"8\">No trend data</td></tr>"}</tbody>
    </table>

    <h2>Expense Breakdown</h2>
    <table>
      <thead><tr><th>Category</th><th>Entries</th><th>Total Amount</th></tr></thead>
      <tbody>${expenseRows || "<tr><td colspan=\"3\">No expense data</td></tr>"}</tbody>
    </table>

    <h2>Top Due Customers</h2>
    <table>
      <thead><tr><th>Customer</th><th>Phone</th><th>Due</th></tr></thead>
      <tbody>${dueRows || "<tr><td colspan=\"3\">No due customer data</td></tr>"}</tbody>
    </table>
  </body>
</html>`;
}

async function exportSpecialPdf(
  report: SummaryResponse,
  selection: SpecialReportSelection,
  generatedAt: string,
) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFont("helvetica", "normal");

  doc.setFontSize(14);
  doc.text(`ShopERP ${selection.label}`.replace(/৳/g, "Tk "), 40, 34);
  doc.setFontSize(10);
  doc.text(`Range: ${formatDate(selection.from)} to ${formatDate(selection.to)} (${selection.groupBy})`, 40, 52);
  doc.text(`Generated: ${formatDateTime(generatedAt)}`.replace(/৳/g, "Tk "), 40, 68);

  autoTable(doc, {
    startY: 84,
    head: [["Metric", "Value"]],
    body: getSpecialSummaryItems(report).map((item) => [item.label, item.value.replace(/৳/g, "Tk ")]),
    styles: { font: "helvetica", fontSize: 8.4, overflow: "linebreak", cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42] },
    theme: "grid",
  });

  let cursorY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 240;

  autoTable(doc, {
    startY: cursorY + 12,
    head: [["Period", "Sell", "Sales Total", "Total Due", "Due Collected", "Total Expenses", "Gross Profit", "Net Profit"]],
    body: report.trend.map((row) => [
      formatSpecialPeriod(row.period, selection.groupBy),
      String(row.sale_count),
      formatTaka(row.sales_total).replace(/৳/g, "Tk "),
      formatTaka(row.due_total).replace(/৳/g, "Tk "),
      formatTaka(row.due_collected).replace(/৳/g, "Tk "),
      formatTaka(row.expense_total).replace(/৳/g, "Tk "),
      formatTaka(row.gross_profit).replace(/৳/g, "Tk "),
      formatTaka(row.net_profit).replace(/৳/g, "Tk "),
    ]),
    styles: { font: "helvetica", fontSize: 7.4, overflow: "linebreak", cellPadding: 3 },
    headStyles: { fillColor: [30, 64, 175] },
    theme: "grid",
  });

  cursorY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cursorY + 90;

  autoTable(doc, {
    startY: cursorY + 12,
    head: [["Category", "Entries", "Total Amount"]],
    body: report.expense_breakdown.map((row) => [
      row.category,
      String(row.expense_count),
      formatTaka(row.total_amount).replace(/৳/g, "Tk "),
    ]),
    styles: { font: "helvetica", fontSize: 7.4, overflow: "linebreak", cellPadding: 3 },
    headStyles: { fillColor: [217, 119, 6] },
    theme: "grid",
  });

  doc.save(`special-report-${selection.key}-${selection.from}-to-${selection.to}.pdf`);
}

function exportSpecialExcel(report: SummaryResponse, selection: SpecialReportSelection) {
  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet(
    getSpecialSummaryItems(report).map((item) => ({ metric: item.label, value: item.value })),
  );

  const trendSheet = XLSX.utils.json_to_sheet(
    report.trend.map((row) => ({
      period: formatSpecialPeriod(row.period, selection.groupBy),
      sell: row.sale_count,
      sales_total: row.sales_total,
      total_due: row.due_total,
      due_collected: row.due_collected,
      total_expenses: row.expense_total,
      gross_profit: row.gross_profit,
      net_profit: row.net_profit,
    })),
  );

  const expenseSheet = XLSX.utils.json_to_sheet(report.expense_breakdown);
  const dueSheet = XLSX.utils.json_to_sheet(
    report.top_due_customers.map((item) => ({
      customer: item.name || "Walk-in",
      phone: item.phone,
      due: item.due,
    })),
  );

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, trendSheet, "Trend");
  XLSX.utils.book_append_sheet(workbook, expenseSheet, "Expense Breakdown");
  XLSX.utils.book_append_sheet(workbook, dueSheet, "Top Due Customers");

  XLSX.writeFile(workbook, `special-report-${selection.key}-${selection.from}-to-${selection.to}.xlsx`);
}

export default function ReportsPage() {
  const defaults = useMemo(() => getDefaultFilters(), []);

  const [draftFilters, setDraftFilters] = useState<ReportFilters>(defaults);
  const [appliedFilters, setAppliedFilters] = useState<ReportFilters>(defaults);
  const [fromDisplayInput, setFromDisplayInput] = useState(formatDate(defaults.from));
  const [toDisplayInput, setToDisplayInput] = useState(formatDate(defaults.to));
  const [generatedAt, setGeneratedAt] = useState(new Date().toISOString());
  const [tablePage, setTablePage] = useState(1);
  const [showSpecialCustomRange, setShowSpecialCustomRange] = useState(false);
  const [specialCustomFromInput, setSpecialCustomFromInput] = useState(formatDate(defaults.from));
  const [specialCustomToInput, setSpecialCustomToInput] = useState(formatDate(defaults.to));
  const [specialCustomGroupBy, setSpecialCustomGroupBy] = useState<GroupBy>(defaults.groupBy);

  useEffect(() => {
    setFromDisplayInput(formatDate(draftFilters.from));
  }, [draftFilters.from]);

  useEffect(() => {
    setToDisplayInput(formatDate(draftFilters.to));
  }, [draftFilters.to]);

  const isDraftRangeValid = useMemo(
    () => isDateRangeValid(draftFilters.from, draftFilters.to),
    [draftFilters.from, draftFilters.to],
  );

  const {
    data: reportData,
    isLoading: reportLoading,
    isError: reportError,
  } = useQuery({
    queryKey: [
      "template-report",
      appliedFilters.template,
      appliedFilters.from,
      appliedFilters.to,
      appliedFilters.groupBy,
      appliedFilters.pageSize,
      tablePage,
    ],
    queryFn: () => fetchTemplateReport(appliedFilters, tablePage),
    enabled: isDateRangeValid(appliedFilters.from, appliedFilters.to),
  });

  const specialCards = useMemo(
    () => [
      { key: "daily", title: "Daily Report" },
      { key: "previous_day", title: "Previous Day Report" },
      { key: "last_week", title: "Last Week Report" },
      { key: "last_15_days", title: "Last 15 Days Report" },
      { key: "last_month", title: "Last Month Report" },
      { key: "last_3_month", title: "Last 3 Month Report" },
      { key: "last_6_month", title: "Last 6 Month Report" },
      { key: "last_12_month", title: "Last 12 Month Report" },
      { key: "custom", title: "Custom Range Report" },
    ] as Array<{ key: SpecialReportCardKey; title: string }>,
    [],
  );

  function applyPreset(preset: RangePreset) {
    const rule = getPresetRange(preset);

    const next: ReportFilters = {
      ...draftFilters,
      preset,
      from: rule.from,
      to: rule.to,
      groupBy: rule.groupBy,
    };

    setDraftFilters(next);
    setAppliedFilters(next);
    setFromDisplayInput(formatDate(next.from));
    setToDisplayInput(formatDate(next.to));
    setTablePage(1);
    setGeneratedAt(new Date().toISOString());
  }

  function handleGenerate() {
    const parsedFrom = parseDisplayDateInput(fromDisplayInput);
    const parsedTo = parseDisplayDateInput(toDisplayInput);

    if (!parsedFrom || !parsedTo || !isDateRangeValid(parsedFrom, parsedTo)) {
      toast.error("Please select a valid range.");
      return;
    }

    if (!isDraftRangeValid) {
      toast.error("Please select a valid range.");
      return;
    }

    const next = {
      ...draftFilters,
      from: parsedFrom,
      to: parsedTo,
    };

    if (next.preset !== "custom") {
      const rule = getPresetRange(next.preset);
      next.groupBy = rule.groupBy;
      next.from = rule.from;
      next.to = rule.to;
    }

    setAppliedFilters(next);
    setTablePage(1);
    setGeneratedAt(new Date().toISOString());
    toast.success("Report generated");
  }

  function handleReset() {
    const fresh = getDefaultFilters();
    setDraftFilters(fresh);
    setAppliedFilters(fresh);
    setFromDisplayInput(formatDate(fresh.from));
    setToDisplayInput(formatDate(fresh.to));
    setSpecialCustomFromInput(formatDate(fresh.from));
    setSpecialCustomToInput(formatDate(fresh.to));
    setSpecialCustomGroupBy(fresh.groupBy);
    setShowSpecialCustomRange(false);
    setTablePage(1);
    setGeneratedAt(new Date().toISOString());
  }

  async function handleExportPdf() {
    if (!reportData) {
      toast.error("Generate report first.");
      return;
    }

    try {
      await exportPdf(reportData, appliedFilters, generatedAt);
      toast.success("PDF exported");
    } catch {
      toast.error("Failed to export PDF");
    }
  }

  function handleExportExcel() {
    if (!reportData) {
      toast.error("Generate report first.");
      return;
    }

    try {
      exportExcel(reportData, appliedFilters);
      toast.success("Excel exported");
    } catch {
      toast.error("Failed to export Excel");
    }
  }

  function handlePrint() {
    if (!reportData) {
      toast.error("Generate report first.");
      return;
    }

    const popup = window.open("", "_blank", "width=1200,height=900");
    if (!popup) {
      toast.error("Popup blocked. Please allow popups.");
      return;
    }

    popup.document.open();
    popup.document.write(buildPrintableHtml(reportData, appliedFilters, generatedAt));
    popup.document.close();
    popup.focus();
    popup.print();
  }

  function openSpecialPreviewTab(selection: SpecialReportSelection) {
    const params = new URLSearchParams({
      key: selection.key,
      label: selection.label,
      from: selection.from,
      to: selection.to,
      groupBy: selection.groupBy,
      generatedAt: new Date().toISOString(),
    });

    window.open(`/reports/special-preview?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  function handleGenerateSpecialReport(cardKey: SpecialReportCardKey) {
    if (cardKey === "custom") {
      setShowSpecialCustomRange(true);
      return;
    }

    const selection = buildSpecialReportSelection(
      cardKey,
      appliedFilters.from,
      appliedFilters.to,
      appliedFilters.groupBy,
    );

    if (!isDateRangeValid(selection.from, selection.to)) {
      toast.error("Please select a valid range");
      return;
    }

    openSpecialPreviewTab(selection);
  }

  function handleOpenSpecialCustomReport() {
    const parsedFrom = parseDisplayDateInput(specialCustomFromInput);
    const parsedTo = parseDisplayDateInput(specialCustomToInput);

    if (!parsedFrom || !parsedTo || !isDateRangeValid(parsedFrom, parsedTo)) {
      toast.error("Please enter a valid custom range in DD-MM-YYYY");
      return;
    }

    const selection = buildSpecialReportSelection("custom", parsedFrom, parsedTo, specialCustomGroupBy);
    openSpecialPreviewTab(selection);
  }

  const showCustomGroupByControl = draftFilters.preset === "custom";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Template Reports</h2>
          <p className="text-sm text-slate-500">
            Detailed but clean report templates with one-click print, PDF, and Excel exports.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handlePrint}>
            Print
          </Button>
          <Button variant="secondary" onClick={handleExportPdf}>
            Export PDF
          </Button>
          <Button variant="secondary" onClick={handleExportExcel}>
            Export Excel
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-900">Common Report Controls</h3>

        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Template</span>
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              value={draftFilters.template}
              onChange={(event) =>
                setDraftFilters((prev) => ({
                  ...prev,
                  template: event.target.value as ReportTemplateKey,
                }))
              }
            >
              <option value="selling">Selling Report</option>
              <option value="due">Due Report</option>
              <option value="stock">Stock Report</option>
              <option value="expense">Expense Report</option>
              <option value="customer">Customer Report</option>
              <option value="profit">Profit Report</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Preset</span>
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              value={draftFilters.preset}
              onChange={(event) => {
                const preset = event.target.value as RangePreset;
                if (preset === "custom") {
                  setDraftFilters((prev) => ({
                    ...prev,
                    preset,
                  }));
                  return;
                }
                applyPreset(preset);
              }}
            >
              <option value="today">Daily</option>
              <option value="yesterday">Yesterday</option>
              <option value="last_week">Last Week</option>
              <option value="last_month">Last Month</option>
              <option value="last_year">Last Year</option>
              <option value="alltime">All Time</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          <Input
            label="From"
            type="text"
            inputMode="numeric"
            placeholder="DD-MM-YYYY"
            value={fromDisplayInput}
            onChange={(event) => {
              setFromDisplayInput(event.target.value);
              setDraftFilters((prev) => ({
                ...prev,
                preset: "custom",
              }));
            }}
            onBlur={() => {
              const parsed = parseDisplayDateInput(fromDisplayInput);
              if (!parsed) {
                return;
              }

              setDraftFilters((prev) => ({
                ...prev,
                preset: "custom",
                from: parsed,
              }));
            }}
          />

          <Input
            label="To"
            type="text"
            inputMode="numeric"
            placeholder="DD-MM-YYYY"
            value={toDisplayInput}
            onChange={(event) => {
              setToDisplayInput(event.target.value);
              setDraftFilters((prev) => ({
                ...prev,
                preset: "custom",
              }));
            }}
            onBlur={() => {
              const parsed = parseDisplayDateInput(toDisplayInput);
              if (!parsed) {
                return;
              }

              setDraftFilters((prev) => ({
                ...prev,
                preset: "custom",
                to: parsed,
              }));
            }}
          />

          {showCustomGroupByControl ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">Group By (Custom)</span>
              <select
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
                value={draftFilters.groupBy}
                onChange={(event) =>
                  setDraftFilters((prev) => ({
                    ...prev,
                    groupBy: event.target.value as GroupBy,
                  }))
                }
              >
                <option value="day">Day</option>
                <option value="month">Month</option>
              </select>
            </label>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">Group By Rule</span>
              <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
                {draftFilters.groupBy === "day"
                  ? "Auto: Day-wise"
                  : "Auto: Month-wise"}
              </div>
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Rows Per Page</span>
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              value={String(draftFilters.pageSize)}
              onChange={(event) =>
                setDraftFilters((prev) => ({
                  ...prev,
                  pageSize: Number(event.target.value),
                }))
              }
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="30">30</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>

          <div className="flex items-end gap-2">
            <Button className="w-full" onClick={handleGenerate}>
              Generate
            </Button>
            <Button variant="ghost" onClick={handleReset}>
              Reset
            </Button>
          </div>
        </div>

        {!isDraftRangeValid ? (
          <p className="mt-2 text-xs text-red-600">
            Please select a valid date range.
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {(["today", "yesterday", "last_week", "last_month", "last_year", "alltime"] as RangePreset[]).map((preset) => (
            <Button key={preset} size="sm" variant={draftFilters.preset === preset ? "primary" : "ghost"} onClick={() => applyPreset(preset)}>
              {presetLabels[preset]}
            </Button>
          ))}
        </div>
      </Card>

      {reportLoading ? <Card className="p-5 text-sm text-slate-500">Generating report...</Card> : null}
      {reportError ? <Card className="p-5 text-sm text-red-600">Failed to generate selected template report.</Card> : null}

      {reportData ? (
        <>
          <div className={`grid gap-3 sm:grid-cols-2 ${getSummaryItemsForTemplate(appliedFilters.template, reportData.summary).length <= 4 ? "xl:grid-cols-4" : "xl:grid-cols-4"}`}>
            {getSummaryItemsForTemplate(appliedFilters.template, reportData.summary).map((item, i) => (
              <StatCard key={i} title={item.label} value={item.value} accent={item.accent} />
            ))}
          </div>

          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-sm font-semibold text-slate-900">{reportData.table.title}</h3>
                <p className="text-xs text-slate-500">
                  Range: {formatDate(appliedFilters.from)} to {formatDate(appliedFilters.to)} | Group by: {appliedFilters.groupBy} | Generated: {formatDateTime(generatedAt)}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    {reportData.table.columns.map((column) => (
                      <th
                        key={column}
                        className={
                          column.toLowerCase().includes("amount") ||
                          column.toLowerCase().includes("profit") ||
                          column.toLowerCase().includes("sales") ||
                          column.toLowerCase().includes("margin") ||
                          column.toLowerCase().includes("due") ||
                          column.toLowerCase().includes("paying") ||
                          column.toLowerCase().includes("paid")
                            ? "px-3 py-2 text-right"
                            : "px-3 py-2 text-left"
                        }
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reportData.table.rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-slate-500" colSpan={reportData.table.columns.length}>
                        No data available in this range.
                      </td>
                    </tr>
                  ) : (
                    reportData.table.rows.map((row, index) => (
                      <tr key={`${reportData.table.key}-${index}`} className="border-t border-slate-100">
                        {reportData.table.columns.map((column) => {
                          const value = row[column] ?? "";
                          const alignClass =
                            column.toLowerCase().includes("amount") ||
                            column.toLowerCase().includes("profit") ||
                            column.toLowerCase().includes("sales") ||
                            column.toLowerCase().includes("margin") ||
                            column.toLowerCase().includes("due") ||
                            column.toLowerCase().includes("paying") ||
                            column.toLowerCase().includes("paid")
                              ? "px-3 py-2 text-right tabular-nums"
                              : "px-3 py-2 text-left";

                          return (
                            <td key={`${reportData.table.key}-${index}-${column}`} className={alignClass}>
                              {formatCellValue(column, value)}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                Showing {reportData.table.rows.length} of {reportData.pagination.total_rows} rows. Page {reportData.pagination.page} of {reportData.pagination.total_pages}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!reportData.pagination.has_prev}
                  onClick={() => setTablePage((prev) => Math.max(prev - 1, 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!reportData.pagination.has_next}
                  onClick={() => setTablePage((prev) => prev + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </Card>

          {reportData.extra_tables.map((table) => (
            <Card key={table.key} className="overflow-hidden">
              <div className="border-b border-slate-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-900">{table.title}</h3>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      {table.columns.map((column) => (
                        <th key={column} className="px-3 py-2 text-left">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.length === 0 ? (
                      <tr>
                        <td className="px-3 py-8 text-center text-slate-500" colSpan={table.columns.length}>
                          No data in this table.
                        </td>
                      </tr>
                    ) : (
                      table.rows.map((row, rowIndex) => (
                        <tr key={`${table.key}-${rowIndex}`} className="border-t border-slate-100">
                          {table.columns.map((column) => (
                            <td key={`${table.key}-${rowIndex}-${column}`} className="px-3 py-2">
                              {formatCellValue(column, row[column] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </>
      ) : null}

      <Card className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Special Summary Section</h3>
            <p className="text-sm text-slate-500">
              Click a template card to open full preview in a new tab, then print or export from that page.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {specialCards.map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={() => handleGenerateSpecialReport(card.key)}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              <p className="text-sm font-semibold text-slate-900">{card.title}</p>
              <p className="mt-1 text-xs text-slate-500">Click to generate</p>
            </button>
          ))}
        </div>

        {showSpecialCustomRange ? (
          <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-4">
            <Input
              label="Custom From"
              type="text"
              inputMode="numeric"
              placeholder="DD-MM-YYYY"
              value={specialCustomFromInput}
              onChange={(event) => setSpecialCustomFromInput(event.target.value)}
            />
            <Input
              label="Custom To"
              type="text"
              inputMode="numeric"
              placeholder="DD-MM-YYYY"
              value={specialCustomToInput}
              onChange={(event) => setSpecialCustomToInput(event.target.value)}
            />
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">Group By</span>
              <select
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
                value={specialCustomGroupBy}
                onChange={(event) => setSpecialCustomGroupBy(event.target.value as GroupBy)}
              >
                <option value="day">Day</option>
                <option value="month">Month</option>
              </select>
            </label>
            <div className="flex items-end">
              <Button className="w-full" onClick={handleOpenSpecialCustomReport}>
                Open Custom Report
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
