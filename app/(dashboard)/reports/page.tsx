"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { StatCard } from "@/components/ui/StatCard";
import { formatDateTime, formatTaka } from "@/lib/utils";

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
    total_customers?: number;
    due_customers_count?: number;
  };
  inventory: {
    movement: {
      restocked_units: number;
      sold_units: number;
      adjustment_net_units: number;
    };
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

type ReportFilters = {
  template: ReportTemplateKey;
  preset: RangePreset;
  from: string;
  to: string;
  groupBy: GroupBy;
  pageSize: number;
};

type SpecialSummaryKey =
  | "daily"
  | "previous_day"
  | "last_week"
  | "last_15_days"
  | "last_month"
  | "last_3_month"
  | "last_6_month"
  | "last_12_month"
  | "custom";

type SpecialSummaryItem = {
  key: SpecialSummaryKey;
  label: string;
  from: string;
  to: string;
  groupBy: GroupBy;
};

type SpecialSummaryRow = {
  key: SpecialSummaryKey;
  label: string;
  range: string;
  summary: SummaryResponse["summary"];
  stockMovement: SummaryResponse["inventory"]["movement"];
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

function validateDateInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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

function formatCellValue(column: string, value: ReportValue) {
  const raw = value ?? "";

  if (column.toLowerCase().includes("margin")) {
    return `${toNumber(raw).toFixed(2)}%`;
  }

  const moneyValue = maybeMoney(raw);
  if (
    moneyValue !== null &&
    (column.toLowerCase().includes("amount") ||
      column.toLowerCase().includes("profit") ||
      column.toLowerCase().includes("sales") ||
      column.toLowerCase().includes("revenue") ||
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
        { label: "Invoices", value: String(summary.sale_count), accent: "blue" as const },
        { label: "Sales Total", value: formatTaka(summary.sales_total), accent: "green" as const },
        { label: "Paid Total", value: formatTaka(summary.paid_total), accent: "blue" as const },
        { label: "Due Total", value: formatTaka(summary.due_total), accent: "orange" as const },
      ];
    case "due":
      return [
        { label: "New Due", value: formatTaka(summary.due_total), accent: "orange" as const },
        { label: "Due Collected", value: formatTaka(summary.due_collected), accent: "green" as const },
        { label: "Outstanding Due", value: formatTaka(summary.outstanding_due), accent: "red" as const },
        { label: "Due Customers", value: String(summary.due_customers), accent: "orange" as const },
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
        { label: "Due Customers", value: String(summary.due_customers), accent: "orange" as const },
        { label: "Outstanding Due", value: formatTaka(summary.outstanding_due), accent: "red" as const },
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
    trendPage: "1",
    trendPageSize: "1",
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

function buildSpecialSummaryItems(customFrom: string, customTo: string, customGroupBy: GroupBy): SpecialSummaryItem[] {
  const now = new Date();
  const today = formatInputDate(now);
  const yesterday = formatInputDate(getYesterday(now));
  const lastWeek = getRollingRange(now, 7);
  const last15Days = getRollingRange(now, 15);
  const lastMonth = getRollingRange(now, 30);
  const last3Month = getRollingRange(now, 90);
  const last6Month = getRollingRange(now, 180);
  const last12Month = getRollingRange(now, 365);

  return [
    {
      key: "daily",
      label: "Daily Report",
      from: today,
      to: today,
      groupBy: "day",
    },
    {
      key: "previous_day",
      label: "Previous Day Report",
      from: yesterday,
      to: yesterday,
      groupBy: "day",
    },
    {
      key: "last_week",
      label: "Last Week Report",
      from: lastWeek.from,
      to: lastWeek.to,
      groupBy: "day",
    },
    {
      key: "last_15_days",
      label: "Last 15 Days Report",
      from: last15Days.from,
      to: last15Days.to,
      groupBy: "day",
    },
    {
      key: "last_month",
      label: "Last Month Report",
      from: lastMonth.from,
      to: lastMonth.to,
      groupBy: "day",
    },
    {
      key: "last_3_month",
      label: "Last 3 Month Report",
      from: last3Month.from,
      to: last3Month.to,
      groupBy: "month",
    },
    {
      key: "last_6_month",
      label: "Last 6 Month Report",
      from: last6Month.from,
      to: last6Month.to,
      groupBy: "month",
    },
    {
      key: "last_12_month",
      label: "Last 12 Month Report",
      from: last12Month.from,
      to: last12Month.to,
      groupBy: "month",
    },
    {
      key: "custom",
      label: "Custom Range Report",
      from: customFrom,
      to: customTo,
      groupBy: customGroupBy,
    },
  ];
}

async function fetchSpecialSummaryData(
  customFrom: string,
  customTo: string,
  customGroupBy: GroupBy,
): Promise<SpecialSummaryRow[]> {
  const items = buildSpecialSummaryItems(customFrom, customTo, customGroupBy);

  const rows = await Promise.all(
    items.map(async (item) => {
      const response = await fetchRangeSummary(item.from, item.to, item.groupBy);

      return {
        key: item.key,
        label: item.label,
        range: `${item.from} to ${item.to}`,
        summary: response.summary,
        stockMovement: response.inventory.movement,
      } satisfies SpecialSummaryRow;
    }),
  );

  return rows;
}

function buildPrintableHtml(
  report: TemplateReportResponse,
  filters: ReportFilters,
  generatedAt: string,
  specialSummaryRows: SpecialSummaryRow[],
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

  const specialRows = specialSummaryRows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.label)}</td>
        <td>${escapeHtml(row.range)}</td>
        <td style="text-align:right">${row.summary.sale_count}</td>
        <td style="text-align:right">${escapeHtml(formatTaka(row.summary.sales_total))}</td>
        <td style="text-align:right">${escapeHtml(formatTaka(row.summary.due_total))}</td>
        <td style="text-align:right">${escapeHtml(formatTaka(row.summary.due_collected))}</td>
        <td style="text-align:right">${escapeHtml(formatTaka(row.summary.expense_total))}</td>
        <td style="text-align:right">${escapeHtml(formatTaka(row.summary.net_profit))}</td>
        <td style="text-align:right">${toNumber(row.summary.total_customers)}</td>
        <td style="text-align:right">${toNumber(row.summary.due_customers_count)}</td>
        <td style="text-align:right">${escapeHtml(formatUnits(row.stockMovement.restocked_units))}</td>
        <td style="text-align:right">${escapeHtml(formatUnits(row.stockMovement.sold_units))}</td>
        <td style="text-align:right">${escapeHtml(formatUnits(row.stockMovement.adjustment_net_units))}</td>
      </tr>`,
    )
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
    <p class="meta">Range: ${escapeHtml(filters.from)} to ${escapeHtml(filters.to)} | Group By: ${escapeHtml(filters.groupBy)} | Generated: ${escapeHtml(formatDateTime(generatedAt))}</p>

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

    <h2>Special Summary Section</h2>
    <table>
      <thead>
        <tr>
          <th>Report</th>
          <th>Range</th>
          <th>Invoices</th>
          <th>Sales</th>
          <th>Due</th>
          <th>Due Collected</th>
          <th>Expenses</th>
          <th>Net Profit</th>
          <th>Customers</th>
          <th>Due Customers</th>
          <th>Stock In</th>
          <th>Stock Out</th>
          <th>Stock Adj.</th>
        </tr>
      </thead>
      <tbody>${specialRows}</tbody>
    </table>
  </body>
</html>`;
}

async function exportPdf(
  report: TemplateReportResponse,
  filters: ReportFilters,
  generatedAt: string,
  specialSummaryRows: SpecialSummaryRow[],
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
  doc.text(`Range: ${filters.from} to ${filters.to} (${filters.groupBy})`, 40, 52);
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

  autoTable(doc, {
    startY: cursorY + 14,
    head: [["Report", "Range", "Invoices", "Sales", "Due", "Due Collected", "Expenses", "Net Profit", "Customers", "Due Customers", "Stock In", "Stock Out", "Stock Adj."]],
    body: specialSummaryRows.map((row) => [
      row.label,
      row.range,
      String(row.summary.sale_count),
      formatTaka(row.summary.sales_total).replace(/৳/g, "Tk "),
      formatTaka(row.summary.due_total).replace(/৳/g, "Tk "),
      formatTaka(row.summary.due_collected).replace(/৳/g, "Tk "),
      formatTaka(row.summary.expense_total).replace(/৳/g, "Tk "),
      formatTaka(row.summary.net_profit).replace(/৳/g, "Tk "),
      String(toNumber(row.summary.total_customers)),
      String(toNumber(row.summary.due_customers_count)),
      formatUnits(row.stockMovement.restocked_units),
      formatUnits(row.stockMovement.sold_units),
      formatUnits(row.stockMovement.adjustment_net_units),
    ]),
    styles: { font: "helvetica", fontSize: 7.2, overflow: "linebreak", cellPadding: 3 },
    headStyles: { fillColor: [2, 132, 199] },
    theme: "grid",
  });

  doc.save(`report-${filters.template}-${filters.from}-to-${filters.to}.pdf`);
}

function exportExcel(
  report: TemplateReportResponse,
  filters: ReportFilters,
  specialSummaryRows: SpecialSummaryRow[],
) {
  const workbook = XLSX.utils.book_new();

  const dynamicSummary = getSummaryItemsForTemplate(filters.template, report.summary).map(
    (item) => ({ metric: item.label, value: item.value })
  );

  const summarySheet = XLSX.utils.json_to_sheet([
    { metric: "Template", value: templateLabels[filters.template] },
    { metric: "From", value: filters.from },
    { metric: "To", value: filters.to },
    { metric: "Group By", value: filters.groupBy },
    ...dynamicSummary,
  ]);

  const mainRows = report.table.rows.map((row) => {
    const normalized: Record<string, ReportValue> = {};
    for (const column of report.table.columns) {
      normalized[column] = row[column] ?? "";
    }
    return normalized;
  });

  const mainSheet = XLSX.utils.json_to_sheet(mainRows);

  const specialSummarySheet = XLSX.utils.json_to_sheet(
    specialSummaryRows.map((row) => ({
      report: row.label,
      range: row.range,
      invoices: row.summary.sale_count,
      sales: row.summary.sales_total,
      due: row.summary.due_total,
      due_collected: row.summary.due_collected,
      expenses: row.summary.expense_total,
      net_profit: row.summary.net_profit,
      customers: toNumber(row.summary.total_customers),
      due_customers: toNumber(row.summary.due_customers_count),
      stock_in: row.stockMovement.restocked_units,
      stock_out: row.stockMovement.sold_units,
      stock_adjustment: row.stockMovement.adjustment_net_units,
    })),
  );

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, mainSheet, report.table.title.slice(0, 31));

  for (const table of report.extra_tables) {
    const rows = table.rows.map((row) => {
      const normalized: Record<string, ReportValue> = {};
      for (const column of table.columns) {
        normalized[column] = row[column] ?? "";
      }
      return normalized;
    });

    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, table.title.slice(0, 31));
  }

  XLSX.utils.book_append_sheet(workbook, specialSummarySheet, "Special Summary");

  XLSX.writeFile(workbook, `report-${filters.template}-${filters.from}-to-${filters.to}.xlsx`);
}

export default function ReportsPage() {
  const defaults = useMemo(() => getDefaultFilters(), []);

  const [draftFilters, setDraftFilters] = useState<ReportFilters>(defaults);
  const [appliedFilters, setAppliedFilters] = useState<ReportFilters>(defaults);
  const [generatedAt, setGeneratedAt] = useState(new Date().toISOString());
  const [tablePage, setTablePage] = useState(1);

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

  const {
    data: specialSummaryRows,
    isLoading: specialLoading,
    isError: specialError,
  } = useQuery({
    queryKey: [
      "special-summary",
      appliedFilters.from,
      appliedFilters.to,
      appliedFilters.groupBy,
    ],
    queryFn: () => fetchSpecialSummaryData(appliedFilters.from, appliedFilters.to, appliedFilters.groupBy),
    enabled: isDateRangeValid(appliedFilters.from, appliedFilters.to),
  });

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
    setTablePage(1);
    setGeneratedAt(new Date().toISOString());
  }

  function handleGenerate() {
    if (!isDraftRangeValid) {
      toast.error("Please select a valid range.");
      return;
    }

    const next = { ...draftFilters };

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
    setTablePage(1);
    setGeneratedAt(new Date().toISOString());
  }

  async function handleExportPdf() {
    if (!reportData || !specialSummaryRows) {
      toast.error("Generate report first.");
      return;
    }

    try {
      await exportPdf(reportData, appliedFilters, generatedAt, specialSummaryRows);
      toast.success("PDF exported");
    } catch {
      toast.error("Failed to export PDF");
    }
  }

  function handleExportExcel() {
    if (!reportData || !specialSummaryRows) {
      toast.error("Generate report first.");
      return;
    }

    try {
      exportExcel(reportData, appliedFilters, specialSummaryRows);
      toast.success("Excel exported");
    } catch {
      toast.error("Failed to export Excel");
    }
  }

  function handlePrint() {
    if (!reportData || !specialSummaryRows) {
      toast.error("Generate report first.");
      return;
    }

    const popup = window.open("", "_blank", "width=1200,height=900");
    if (!popup) {
      toast.error("Popup blocked. Please allow popups.");
      return;
    }

    popup.document.open();
    popup.document.write(buildPrintableHtml(reportData, appliedFilters, generatedAt, specialSummaryRows));
    popup.document.close();
    popup.focus();
    popup.print();
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
            type="date"
            value={draftFilters.from}
            onChange={(event) =>
              setDraftFilters((prev) => ({
                ...prev,
                preset: "custom",
                from: event.target.value,
              }))
            }
          />

          <Input
            label="To"
            type="date"
            value={draftFilters.to}
            onChange={(event) =>
              setDraftFilters((prev) => ({
                ...prev,
                preset: "custom",
                to: event.target.value,
              }))
            }
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
      {specialLoading ? <Card className="p-5 text-sm text-slate-500">Loading special summary section...</Card> : null}
      {specialError ? <Card className="p-5 text-sm text-red-600">Failed to load special summary section.</Card> : null}

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
                  Range: {appliedFilters.from} to {appliedFilters.to} | Group by: {appliedFilters.groupBy} | Generated: {formatDateTime(generatedAt)}
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
                          column.toLowerCase().includes("revenue") ||
                          column.toLowerCase().includes("paying")
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
                            column.toLowerCase().includes("revenue") ||
                            column.toLowerCase().includes("paying")
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

      {specialSummaryRows ? (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Special Summary Section</h3>
            <p className="mt-1 text-xs text-slate-500">
              Daily, previous day, last week, last 15 days, last month, last 3/6/12 month, and custom summary reports.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Report</th>
                  <th className="px-3 py-2 text-left">Range</th>
                  <th className="px-3 py-2 text-right">Invoices</th>
                  <th className="px-3 py-2 text-right">Sales</th>
                  <th className="px-3 py-2 text-right">Due</th>
                  <th className="px-3 py-2 text-right">Due Collected</th>
                  <th className="px-3 py-2 text-right">Expenses</th>
                  <th className="px-3 py-2 text-right">Net Profit</th>
                  <th className="px-3 py-2 text-right">Customers</th>
                  <th className="px-3 py-2 text-right">Due Customers</th>
                  <th className="px-3 py-2 text-right">Stock In</th>
                  <th className="px-3 py-2 text-right">Stock Out</th>
                  <th className="px-3 py-2 text-right">Stock Adj.</th>
                </tr>
              </thead>
              <tbody>
                {specialSummaryRows.map((row) => (
                  <tr key={row.key} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-900">{row.label}</td>
                    <td className="px-3 py-2 text-slate-600">{row.range}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.summary.sale_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatTaka(row.summary.sales_total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatTaka(row.summary.due_total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatTaka(row.summary.due_collected)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatTaka(row.summary.expense_total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatTaka(row.summary.net_profit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{toNumber(row.summary.total_customers)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{toNumber(row.summary.due_customers_count)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUnits(row.stockMovement.restocked_units)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUnits(row.stockMovement.sold_units)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUnits(row.stockMovement.adjustment_net_units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
