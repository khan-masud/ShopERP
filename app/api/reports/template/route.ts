import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { roundMoney } from "@/lib/server/crypto";
import { dbQuery } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

type GroupBy = "day" | "month";
type TemplateKey = "selling" | "due" | "stock" | "expense" | "customer" | "profit";
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
  template: TemplateKey;
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

interface NumberValueRow extends RowDataPacket {
  value: string | number;
}

interface SalesSummaryRow extends RowDataPacket {
  sale_count: number;
  sales_total: string;
  due_total: string;
  paid_total: string;
}

interface StockMovementRow extends RowDataPacket {
  restocked_units: string;
  sold_units: string;
  adjustment_units: string;
}

interface GenericRow extends RowDataPacket {
  [key: string]: unknown;
}

type PaginationContext = {
  page: number;
  pageSize: number;
  offset: number;
  totalRows: number;
  totalPages: number;
};

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isValidDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() + 1 === month &&
    candidate.getUTCDate() === day
  );
}

function formatDateKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parsePage(input: string | null) {
  const parsed = Number(input ?? 1);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), 100000);
}

function parsePageSize(input: string | null) {
  const parsed = Number(input ?? 20);
  if (!Number.isFinite(parsed)) {
    return 20;
  }

  return Math.min(Math.max(Math.floor(parsed), 5), 200);
}

function parseTemplate(input: string | null): TemplateKey {
  const template = (input ?? "").trim().toLowerCase();

  if (
    template === "selling" ||
    template === "due" ||
    template === "stock" ||
    template === "expense" ||
    template === "customer" ||
    template === "profit"
  ) {
    return template;
  }

  throw new ApiError(400, "Invalid template. Use selling, due, stock, expense, customer, or profit");
}

function getDefaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 29);

  return {
    from: formatDateKey(start),
    to: formatDateKey(end),
  };
}

async function getTotalRows(sql: string, params: Array<string | number>) {
  const rows = await dbQuery<NumberValueRow[]>(sql, params);
  return Number(rows[0]?.value ?? 0);
}

function buildPaginationContext(totalRows: number, requestedPage: number, requestedPageSize: number): PaginationContext {
  const safePageSize = Math.max(requestedPageSize, 1);
  const totalPages = Math.max(Math.ceil(totalRows / safePageSize), 1);
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const offset = (page - 1) * safePageSize;

  return {
    page,
    pageSize: safePageSize,
    offset,
    totalRows,
    totalPages,
  };
}

function toPaginationPayload(pagination: PaginationContext): PaginationPayload {
  return {
    page: pagination.page,
    page_size: pagination.pageSize,
    total_rows: pagination.totalRows,
    total_pages: pagination.totalPages,
    has_prev: pagination.page > 1,
    has_next: pagination.page < pagination.totalPages,
  };
}

async function buildRangeSummary(from: string, to: string) {
  const [
    salesSummaryRows,
    grossProfitRows,
    dueCollectedRows,
    expenseRows,
    outstandingDueRows,
    todayDueAmountRows,
    todayDueCustomersRows,
    totalCustomersRows,
    dueCustomersRows,
    stockMovementRows,
  ] = await Promise.all([
    dbQuery<SalesSummaryRow[]>(
      `SELECT
         COUNT(*) AS sale_count,
         COALESCE(SUM(total), 0) AS sales_total,
         COALESCE(SUM(due), 0) AS due_total,
         COALESCE(SUM(paid), 0) AS paid_total
       FROM sales
       WHERE DATE(created_at) BETWEEN ? AND ?`,
      [from, to],
    ),
    dbQuery<NumberValueRow[]>(
      `SELECT COALESCE(SUM((si.sell_price - si.buy_price) * si.quantity), 0) AS value
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       WHERE DATE(s.created_at) BETWEEN ? AND ?`,
      [from, to],
    ),
    dbQuery<NumberValueRow[]>(
      `SELECT COALESCE(SUM(amount), 0) AS value
       FROM due_payments
       WHERE DATE(created_at) BETWEEN ? AND ?`,
      [from, to],
    ),
    dbQuery<NumberValueRow[]>(
      `SELECT COALESCE(SUM(amount), 0) AS value
       FROM expenses
       WHERE expense_date BETWEEN ? AND ?
         AND is_deleted = 0`,
      [from, to],
    ),
    dbQuery<NumberValueRow[]>(
      `SELECT COALESCE(SUM(due), 0) AS value
       FROM customers
       WHERE is_active = 1`,
    ),
    dbQuery<NumberValueRow[]>(
      `SELECT COALESCE(SUM(due), 0) AS value
       FROM sales
       WHERE DATE(created_at) BETWEEN ? AND ?
         AND due > 0`,
      [from, to],
    ),
    dbQuery<NumberValueRow[]>(
      `SELECT COUNT(DISTINCT COALESCE(customer_id, customer_phone)) AS value
       FROM sales
       WHERE DATE(created_at) BETWEEN ? AND ?
         AND due > 0`,
      [from, to],
    ),
    dbQuery<NumberValueRow[]>(
      `SELECT COUNT(*) AS value
       FROM customers
       WHERE is_active = 1`,
    ),
    dbQuery<NumberValueRow[]>(
      `SELECT COUNT(*) AS value
       FROM customers
       WHERE is_active = 1
         AND due > 0`,
    ),
    dbQuery<StockMovementRow[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN change_type = 'restock' AND quantity_change > 0 THEN quantity_change ELSE 0 END), 0) AS restocked_units,
         COALESCE(SUM(CASE WHEN change_type = 'sale' THEN ABS(quantity_change) ELSE 0 END), 0) AS sold_units,
         COALESCE(SUM(CASE WHEN change_type = 'adjustment' THEN quantity_change ELSE 0 END), 0) AS adjustment_units
       FROM stock_history
       WHERE DATE(created_at) BETWEEN ? AND ?`,
      [from, to],
    ),
  ]);

  const salesSummary = salesSummaryRows[0];
  const grossProfit = roundMoney(toNumber(grossProfitRows[0]?.value));
  const expensesTotal = roundMoney(toNumber(expenseRows[0]?.value));
  const netProfit = roundMoney(grossProfit - expensesTotal);
  const stockMovement = stockMovementRows[0];

  return {
    sale_count: Number(salesSummary?.sale_count ?? 0),
    sales_total: roundMoney(toNumber(salesSummary?.sales_total)),
    due_total: roundMoney(toNumber(salesSummary?.due_total)),
    paid_total: roundMoney(toNumber(salesSummary?.paid_total)),
    due_collected: roundMoney(toNumber(dueCollectedRows[0]?.value)),
    expenses_total: expensesTotal,
    gross_profit: grossProfit,
    net_profit: netProfit,
    outstanding_due: roundMoney(toNumber(outstandingDueRows[0]?.value)),
    today_due_amount: roundMoney(toNumber(todayDueAmountRows[0]?.value)),
    today_due_customers: Number(todayDueCustomersRows[0]?.value ?? 0),
    total_customers: Number(totalCustomersRows[0]?.value ?? 0),
    due_customers: Number(dueCustomersRows[0]?.value ?? 0),
    stock_in_units: roundMoney(toNumber(stockMovement?.restocked_units)),
    stock_out_units: roundMoney(toNumber(stockMovement?.sold_units)),
    stock_adjustment_units: roundMoney(toNumber(stockMovement?.adjustment_units)),
  };
}

function monthExpression(column: string) {
  return `DATE_FORMAT(${column}, '%Y-%m')`;
}

async function buildSellingTable(
  from: string,
  to: string,
  groupBy: GroupBy,
  requestedPage: number,
  requestedPageSize: number,
): Promise<{ table: ReportTable; pagination: PaginationContext; extraTables: ReportTable[] }> {
  if (groupBy === "day") {
    const totalRows = await getTotalRows(
      `SELECT COUNT(DISTINCT COALESCE(customer_id, CONCAT('phone:', customer_phone))) AS value
       FROM sales
       WHERE DATE(created_at) BETWEEN ? AND ?`,
      [from, to],
    );

    const pagination = buildPaginationContext(totalRows, requestedPage, requestedPageSize);

    const rows = await dbQuery<GenericRow[]>(
      `SELECT
         DATE_FORMAT(s.created_at, '%d-%m-%Y %H:%i') AS report_date,
         s.id AS sale_id,
         COALESCE(s.customer_name, c.name, 'Walk-in') AS customer_name,
         COALESCE(s.total, 0) AS amount,
         COALESCE(s.due, 0) AS due_amount,
         COALESCE(s.paid, 0) AS sales_amount,
         COALESCE(p.gross_profit, 0) AS profit
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN (
         SELECT
           si.sale_id,
           COALESCE(SUM((si.sell_price - si.buy_price) * si.quantity), 0) AS gross_profit
         FROM sale_items si
         GROUP BY si.sale_id
       ) p ON p.sale_id = s.id
       WHERE DATE(s.created_at) BETWEEN ? AND ?
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT ? OFFSET ?`,
      [from, to, pagination.pageSize, pagination.offset],
    );

    return {
      table: {
        key: "selling-report",
        title: "Selling Report",
        columns: ["Date", "Sale ID", "Customer", "Amount", "Due Amount", "Sales amount", "Profit"],
        rows: rows.map((row) => ({
          Date: String(row.report_date ?? ""),
          "Sale ID": Number(row.sale_id ?? 0),
          Customer: String(row.customer_name ?? "Walk-in"),
          Amount: roundMoney(toNumber(row.amount)),
          "Due Amount": roundMoney(toNumber(row.due_amount)),
          "Sales amount": roundMoney(toNumber(row.sales_amount)),
          Profit: roundMoney(toNumber(row.profit)),
        })),
      },
      pagination,
      extraTables: [],
    };
  }

  const totalRows = await getTotalRows(
    `SELECT COUNT(*) AS value
     FROM (
       SELECT ${monthExpression("created_at")} AS period_month
       FROM sales
       WHERE DATE(created_at) BETWEEN ? AND ?
       GROUP BY ${monthExpression("created_at")}
     ) grouped_rows`,
    [from, to],
  );

  const pagination = buildPaginationContext(totalRows, requestedPage, requestedPageSize);

  const rows = await dbQuery<GenericRow[]>(
    `SELECT
       ${monthExpression("s.created_at")} AS period_month,
       COUNT(*) AS invoices,
       COALESCE(SUM(s.total), 0) AS amount,
       COALESCE(SUM(s.due), 0) AS due_amount,
      COALESCE(SUM(s.paid), 0) AS sales_amount,
       COALESCE(SUM(p.gross_profit), 0) AS profit
     FROM sales s
     LEFT JOIN (
       SELECT
         si.sale_id,
         COALESCE(SUM((si.sell_price - si.buy_price) * si.quantity), 0) AS gross_profit
       FROM sale_items si
       GROUP BY si.sale_id
     ) p ON p.sale_id = s.id
     WHERE DATE(s.created_at) BETWEEN ? AND ?
     GROUP BY ${monthExpression("s.created_at")}
     ORDER BY period_month DESC
     LIMIT ? OFFSET ?`,
    [from, to, pagination.pageSize, pagination.offset],
  );

  return {
    table: {
      key: "selling-report",
      title: "Selling Report",
      columns: ["Month", "Sell", "Amount", "Due Amount", "Sales amount", "Profit"],
      rows: rows.map((row) => ({
        Month: String(row.period_month ?? ""),
        Sell: Number(row.invoices ?? 0),
        Amount: roundMoney(toNumber(row.amount)),
        "Due Amount": roundMoney(toNumber(row.due_amount)),
        "Sales amount": roundMoney(toNumber(row.sales_amount)),
        Profit: roundMoney(toNumber(row.profit)),
      })),
    },
    pagination,
    extraTables: [],
  };
}

async function buildDueTable(
  from: string,
  to: string,
  groupBy: GroupBy,
  requestedPage: number,
  requestedPageSize: number,
): Promise<{ table: ReportTable; pagination: PaginationContext; extraTables: ReportTable[] }> {
  if (groupBy === "day") {
    const totalRows = await getTotalRows(
      `SELECT COUNT(DISTINCT COALESCE(customer_id, CONCAT('phone:', customer_phone))) AS value
       FROM sales
       WHERE DATE(created_at) BETWEEN ? AND ?
         AND due > 0`,
      [from, to],
    );

    const pagination = buildPaginationContext(totalRows, requestedPage, requestedPageSize);

    const rows = await dbQuery<GenericRow[]>(
      `SELECT
         DATE_FORMAT(MAX(s.created_at), '%d-%m-%Y %H:%i') AS report_date,
         COALESCE(MAX(s.customer_name), MAX(c.name), 'Walk-in') AS customer_name,
         MAX(s.customer_phone) AS customer_phone,
         GROUP_CONCAT(CAST(s.id AS CHAR) ORDER BY s.created_at DESC, s.id DESC SEPARATOR ', ') AS sell_ids,
         COALESCE(SUM(s.total), 0) AS total_amount,
         COALESCE(SUM(s.paid), 0) AS paid_amount,
         COALESCE(SUM(s.due), 0) AS due_amount,
         COALESCE(SUM(dp.collected), 0) AS due_collected
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN (
         SELECT
           sale_id,
           COALESCE(SUM(amount), 0) AS collected
         FROM due_payments
         GROUP BY sale_id
       ) dp ON dp.sale_id = s.id
       WHERE DATE(s.created_at) BETWEEN ? AND ?
         AND s.due > 0
       GROUP BY COALESCE(s.customer_id, CONCAT('phone:', s.customer_phone)), s.customer_phone
       ORDER BY MAX(s.created_at) DESC
       LIMIT ? OFFSET ?`,
      [from, to, pagination.pageSize, pagination.offset],
    );

    return {
      table: {
        key: "due-report",
        title: "Due Report",
        columns: ["Date", "Customer", "Phone", "Sell IDs", "Total Amount", "Paid", "Due Amount", "Due Collected"],
        rows: rows.map((row) => ({
          Date: String(row.report_date ?? ""),
          Customer: String(row.customer_name ?? "Walk-in"),
          Phone: String(row.customer_phone ?? ""),
          "Sell IDs": String(row.sell_ids ?? ""),
          "Total Amount": roundMoney(toNumber(row.total_amount)),
          Paid: roundMoney(toNumber(row.paid_amount)),
          "Due Amount": roundMoney(toNumber(row.due_amount)),
          "Due Collected": roundMoney(toNumber(row.due_collected)),
        })),
      },
      pagination,
      extraTables: [],
    };
  }

  const totalRows = await getTotalRows(
    `SELECT COUNT(*) AS value
     FROM (
       SELECT
         ${monthExpression("s.created_at")} AS period_month,
         COALESCE(s.customer_id, CONCAT('phone:', s.customer_phone)) AS customer_key
       FROM sales s
       WHERE DATE(s.created_at) BETWEEN ? AND ?
         AND s.due > 0
       GROUP BY ${monthExpression("s.created_at")}, customer_key
     ) grouped_rows`,
    [from, to],
  );

  const pagination = buildPaginationContext(totalRows, requestedPage, requestedPageSize);

  const rows = await dbQuery<GenericRow[]>(
    `SELECT
       ${monthExpression("s.created_at")} AS period_month,
       COALESCE(MAX(s.customer_name), MAX(c.name), 'Walk-in') AS customer_name,
       MAX(s.customer_phone) AS customer_phone,
       GROUP_CONCAT(CAST(s.id AS CHAR) ORDER BY s.created_at DESC, s.id DESC SEPARATOR ', ') AS sell_ids,
       COALESCE(SUM(s.total), 0) AS total_amount,
       COALESCE(SUM(s.paid), 0) AS paid_amount,
       COALESCE(SUM(s.due), 0) AS due_amount,
       COALESCE(SUM(dp.collected), 0) AS due_collected,
       MAX(s.created_at) AS latest_sale_at
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN (
       SELECT
         sale_id,
         COALESCE(SUM(amount), 0) AS collected
       FROM due_payments
       GROUP BY sale_id
     ) dp ON dp.sale_id = s.id
     WHERE DATE(s.created_at) BETWEEN ? AND ?
       AND s.due > 0
     GROUP BY ${monthExpression("s.created_at")}, COALESCE(s.customer_id, CONCAT('phone:', s.customer_phone)), s.customer_phone
     ORDER BY period_month DESC, latest_sale_at DESC
     LIMIT ? OFFSET ?`,
    [from, to, pagination.pageSize, pagination.offset],
  );

  return {
    table: {
      key: "due-report",
      title: "Due Report",
      columns: ["Month", "Customer", "Phone", "Sell IDs", "Total Amount", "Paid", "Due Amount", "Due Collected"],
      rows: rows.map((row) => ({
        Month: String(row.period_month ?? ""),
        Customer: String(row.customer_name ?? "Walk-in"),
        Phone: String(row.customer_phone ?? ""),
        "Sell IDs": String(row.sell_ids ?? ""),
        "Total Amount": roundMoney(toNumber(row.total_amount)),
        Paid: roundMoney(toNumber(row.paid_amount)),
        "Due Amount": roundMoney(toNumber(row.due_amount)),
        "Due Collected": roundMoney(toNumber(row.due_collected)),
      })),
    },
    pagination,
    extraTables: [],
  };
}

async function buildStockTable(
  from: string,
  to: string,
  groupBy: GroupBy,
  requestedPage: number,
  requestedPageSize: number,
): Promise<{ table: ReportTable; pagination: PaginationContext; extraTables: ReportTable[] }> {
  if (groupBy === "day") {
    const totalRows = await getTotalRows(
      `SELECT COUNT(DISTINCT product_id) AS value
       FROM stock_history
       WHERE DATE(created_at) BETWEEN ? AND ?`,
      [from, to],
    );

    const pagination = buildPaginationContext(totalRows, requestedPage, requestedPageSize);

    const rows = await dbQuery<GenericRow[]>(
      `SELECT
         DATE_FORMAT(MAX(sh.created_at), '%d-%m-%Y %H:%i') AS report_date,
         MAX(sh.product_name) AS product_name,
         CAST(
           SUBSTRING_INDEX(
             GROUP_CONCAT(sh.quantity_before ORDER BY sh.created_at ASC, sh.id ASC SEPARATOR ','),
             ',',
             1
           ) AS SIGNED
         ) AS previous_stock,
         CAST(
           SUBSTRING_INDEX(
             GROUP_CONCAT(sh.quantity_after ORDER BY sh.created_at DESC, sh.id DESC SEPARATOR ','),
             ',',
             1
           ) AS SIGNED
         ) AS current_stock,
         CASE
           WHEN COUNT(DISTINCT sh.change_type) = 1 THEN MAX(sh.change_type)
           ELSE 'mixed'
         END AS change_type,
         COALESCE(SUM(sh.quantity_change), 0) AS quantity_change
       FROM stock_history sh
       WHERE DATE(sh.created_at) BETWEEN ? AND ?
       GROUP BY sh.product_id
       ORDER BY MAX(sh.created_at) DESC, product_name ASC
       LIMIT ? OFFSET ?`,
      [from, to, pagination.pageSize, pagination.offset],
    );

    const restockAdjustmentRows = await dbQuery<GenericRow[]>(
      `SELECT
         DATE_FORMAT(created_at, '%d-%m-%Y %H:%i') AS report_date,
         product_name,
         change_type,
         quantity_change,
         quantity_before,
         quantity_after,
         COALESCE(note, '') AS note
       FROM stock_history
       WHERE DATE(created_at) BETWEEN ? AND ?
         AND change_type IN ('restock', 'adjustment')
       ORDER BY created_at DESC, id DESC
       LIMIT 200`,
      [from, to],
    );

    return {
      table: {
        key: "stock-report",
        title: "Stock Report",
        columns: ["Date", "Product", "Previous Stock", "Current Stock", "Change Type", "Change Units"],
        rows: rows.map((row) => ({
          Date: String(row.report_date ?? ""),
          Product: String(row.product_name ?? ""),
          "Previous Stock": Number(row.previous_stock ?? 0),
          "Current Stock": Number(row.current_stock ?? 0),
          "Change Type": String(row.change_type ?? ""),
          "Change Units": Number(row.quantity_change ?? 0),
        })),
      },
      pagination,
      extraTables: [
        {
          key: "stock-restock-adjustment",
          title: "Restock And Adjustment Details",
          columns: [
            "Date",
            "Product",
            "Change Type",
            "Change Units",
            "Previous Stock",
            "Current Stock",
            "Note",
          ],
          rows: restockAdjustmentRows.map((row) => ({
            Date: String(row.report_date ?? ""),
            Product: String(row.product_name ?? ""),
            "Change Type": String(row.change_type ?? ""),
            "Change Units": Number(row.quantity_change ?? 0),
            "Previous Stock": Number(row.quantity_before ?? 0),
            "Current Stock": Number(row.quantity_after ?? 0),
            Note: String(row.note ?? ""),
          })),
        },
      ],
    };
  }

  const totalRows = await getTotalRows(
    `SELECT COUNT(*) AS value
     FROM (
       SELECT
         ${monthExpression("created_at")} AS period_month,
         product_id
       FROM stock_history
       WHERE DATE(created_at) BETWEEN ? AND ?
       GROUP BY ${monthExpression("created_at")}, product_id
     ) grouped_rows`,
    [from, to],
  );

  const pagination = buildPaginationContext(totalRows, requestedPage, requestedPageSize);

  const rows = await dbQuery<GenericRow[]>(
    `SELECT
       ${monthExpression("sh.created_at")} AS period_month,
       sh.product_id,
       MAX(sh.product_name) AS product_name,
       CAST(
         SUBSTRING_INDEX(
           GROUP_CONCAT(sh.quantity_before ORDER BY sh.created_at ASC, sh.id ASC SEPARATOR ','),
           ',',
           1
         ) AS SIGNED
       ) AS previous_stock,
       CAST(
         SUBSTRING_INDEX(
           GROUP_CONCAT(sh.quantity_after ORDER BY sh.created_at DESC, sh.id DESC SEPARATOR ','),
           ',',
           1
         ) AS SIGNED
       ) AS current_stock,
       COALESCE(SUM(CASE WHEN sh.change_type = 'restock' AND sh.quantity_change > 0 THEN sh.quantity_change ELSE 0 END), 0) AS restock_units,
       COALESCE(SUM(CASE WHEN sh.change_type = 'sale' THEN ABS(sh.quantity_change) ELSE 0 END), 0) AS sale_units,
       COALESCE(SUM(CASE WHEN sh.change_type = 'adjustment' THEN sh.quantity_change ELSE 0 END), 0) AS adjustment_units
     FROM stock_history sh
     WHERE DATE(sh.created_at) BETWEEN ? AND ?
     GROUP BY ${monthExpression("sh.created_at")}, sh.product_id
     ORDER BY period_month DESC, product_name ASC
     LIMIT ? OFFSET ?`,
    [from, to, pagination.pageSize, pagination.offset],
  );

  const restockAdjustmentRows = await dbQuery<GenericRow[]>(
    `SELECT
       ${monthExpression("created_at")} AS period_month,
       product_name,
       COALESCE(SUM(CASE WHEN change_type = 'restock' AND quantity_change > 0 THEN quantity_change ELSE 0 END), 0) AS restock_units,
       COALESCE(SUM(CASE WHEN change_type = 'adjustment' THEN quantity_change ELSE 0 END), 0) AS adjustment_units,
       COALESCE(SUM(CASE WHEN change_type = 'restock' THEN 1 ELSE 0 END), 0) AS restock_entries,
       COALESCE(SUM(CASE WHEN change_type = 'adjustment' THEN 1 ELSE 0 END), 0) AS adjustment_entries
     FROM stock_history
     WHERE DATE(created_at) BETWEEN ? AND ?
       AND change_type IN ('restock', 'adjustment')
     GROUP BY ${monthExpression("created_at")}, product_name
     ORDER BY period_month DESC, product_name ASC
     LIMIT 500`,
    [from, to],
  );

  return {
    table: {
      key: "stock-report",
      title: "Stock Report",
      columns: [
        "Month",
        "Product",
        "Previous Stock",
        "Current Stock",
        "Restock Units",
        "Sold Units",
        "Adjustment Units",
      ],
      rows: rows.map((row) => ({
        Month: String(row.period_month ?? ""),
        Product: String(row.product_name ?? ""),
        "Previous Stock": Number(row.previous_stock ?? 0),
        "Current Stock": Number(row.current_stock ?? 0),
        "Restock Units": Number(row.restock_units ?? 0),
        "Sold Units": Number(row.sale_units ?? 0),
        "Adjustment Units": Number(row.adjustment_units ?? 0),
      })),
    },
    pagination,
    extraTables: [
      {
        key: "stock-restock-adjustment",
        title: "Restock And Adjustment Details",
        columns: ["Month", "Product", "Restock Units", "Adjustment Units", "Restock Entries", "Adjustment Entries"],
        rows: restockAdjustmentRows.map((row) => ({
          Month: String(row.period_month ?? ""),
          Product: String(row.product_name ?? ""),
          "Restock Units": Number(row.restock_units ?? 0),
          "Adjustment Units": Number(row.adjustment_units ?? 0),
          "Restock Entries": Number(row.restock_entries ?? 0),
          "Adjustment Entries": Number(row.adjustment_entries ?? 0),
        })),
      },
    ],
  };
}

async function buildExpenseTable(
  from: string,
  to: string,
  groupBy: GroupBy,
  requestedPage: number,
  requestedPageSize: number,
): Promise<{ table: ReportTable; pagination: PaginationContext; extraTables: ReportTable[] }> {
  if (groupBy === "day") {
    const totalRows = await getTotalRows(
      `SELECT COUNT(*) AS value
       FROM expenses
       WHERE expense_date BETWEEN ? AND ?
         AND is_deleted = 0`,
      [from, to],
    );

    const pagination = buildPaginationContext(totalRows, requestedPage, requestedPageSize);

    const rows = await dbQuery<GenericRow[]>(
      `SELECT
         DATE_FORMAT(expense_date, '%d-%m-%Y') AS report_date,
         title AS expense,
         category,
         amount,
         COALESCE(note, '') AS note
       FROM expenses
       WHERE expense_date BETWEEN ? AND ?
         AND is_deleted = 0
       ORDER BY expense_date DESC, created_at DESC
       LIMIT ? OFFSET ?`,
      [from, to, pagination.pageSize, pagination.offset],
    );

    return {
      table: {
        key: "expense-report",
        title: "Expense Report",
        columns: ["Date", "Expense", "Category", "Amount", "Where/Note"],
        rows: rows.map((row) => ({
          Date: String(row.report_date ?? ""),
          Expense: String(row.expense ?? ""),
          Category: String(row.category ?? ""),
          Amount: roundMoney(toNumber(row.amount)),
          "Where/Note": String(row.note ?? ""),
        })),
      },
      pagination,
      extraTables: [],
    };
  }

  const totalRows = await getTotalRows(
    `SELECT COUNT(*) AS value
     FROM (
       SELECT
         ${monthExpression("expense_date")} AS period_month,
         category
       FROM expenses
       WHERE expense_date BETWEEN ? AND ?
         AND is_deleted = 0
       GROUP BY ${monthExpression("expense_date")}, category
     ) grouped_rows`,
    [from, to],
  );

  const pagination = buildPaginationContext(totalRows, requestedPage, requestedPageSize);

  const rows = await dbQuery<GenericRow[]>(
    `SELECT
       ${monthExpression("expense_date")} AS period_month,
       category,
       COUNT(*) AS entries,
       COALESCE(SUM(amount), 0) AS total_amount
     FROM expenses
     WHERE expense_date BETWEEN ? AND ?
       AND is_deleted = 0
     GROUP BY ${monthExpression("expense_date")}, category
     ORDER BY period_month DESC, total_amount DESC
     LIMIT ? OFFSET ?`,
    [from, to, pagination.pageSize, pagination.offset],
  );

  return {
    table: {
      key: "expense-report",
      title: "Expense Report",
      columns: ["Month", "Category", "Entries", "Amount"],
      rows: rows.map((row) => ({
        Month: String(row.period_month ?? ""),
        Category: String(row.category ?? ""),
        Entries: Number(row.entries ?? 0),
        Amount: roundMoney(toNumber(row.total_amount)),
      })),
    },
    pagination,
    extraTables: [],
  };
}

async function buildCustomerTable(
  from: string,
  to: string,
  groupBy: GroupBy,
  requestedPage: number,
  requestedPageSize: number,
): Promise<{ table: ReportTable; pagination: PaginationContext; extraTables: ReportTable[] }> {
  if (groupBy === "day") {
    const totalRows = await getTotalRows(
      `SELECT COUNT(*) AS value
       FROM sales
       WHERE DATE(created_at) BETWEEN ? AND ?`,
      [from, to],
    );

    const pagination = buildPaginationContext(totalRows, requestedPage, requestedPageSize);

    const rows = await dbQuery<GenericRow[]>(
      `SELECT
         DATE_FORMAT(MAX(s.created_at), '%d-%m-%Y %H:%i') AS report_date,
         COALESCE(MAX(s.customer_name), MAX(c.name), 'Walk-in') AS customer_name,
         MAX(s.customer_phone) AS customer_phone,
         GROUP_CONCAT(CAST(s.id AS CHAR) ORDER BY s.created_at DESC, s.id DESC SEPARATOR ', ') AS sell_ids,
         COUNT(*) AS sell_count,
         COALESCE(SUM(s.paid), 0) AS paid_amount,
         COALESCE(SUM(s.due), 0) AS due_amount,
         COALESCE(SUM(s.total), 0) AS total_amount
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE DATE(s.created_at) BETWEEN ? AND ?
       GROUP BY COALESCE(s.customer_id, CONCAT('phone:', s.customer_phone)), s.customer_phone
       ORDER BY MAX(s.created_at) DESC
       LIMIT ? OFFSET ?`,
      [from, to, pagination.pageSize, pagination.offset],
    );

    return {
      table: {
        key: "customer-report",
        title: "Customer Report",
        columns: ["Date", "Customer", "Phone", "Sell IDs", "Sell", "Paid", "Due Amount", "Total Amount"],
        rows: rows.map((row) => ({
          Date: String(row.report_date ?? ""),
          Customer: String(row.customer_name ?? "Walk-in"),
          Phone: String(row.customer_phone ?? ""),
          "Sell IDs": String(row.sell_ids ?? ""),
          Sell: Number(row.sell_count ?? 0),
          Paid: roundMoney(toNumber(row.paid_amount)),
          "Due Amount": roundMoney(toNumber(row.due_amount)),
          "Total Amount": roundMoney(toNumber(row.total_amount)),
        })),
      },
      pagination,
      extraTables: [],
    };
  }

  const totalRows = await getTotalRows(
    `SELECT COUNT(DISTINCT COALESCE(customer_id, CONCAT('phone:', customer_phone))) AS value
     FROM sales
     WHERE DATE(created_at) BETWEEN ? AND ?`,
    [from, to],
  );

  const pagination = buildPaginationContext(totalRows, requestedPage, requestedPageSize);

  const rows = await dbQuery<GenericRow[]>(
    `SELECT
       DATE_FORMAT(MAX(s.created_at), '%d-%m-%Y %H:%i') AS report_date,
       COALESCE(MAX(s.customer_name), MAX(c.name), 'Walk-in') AS customer_name,
       MAX(s.customer_phone) AS customer_phone,
       GROUP_CONCAT(CAST(s.id AS CHAR) ORDER BY s.created_at DESC, s.id DESC SEPARATOR ', ') AS sell_ids,
       COUNT(*) AS sell_count,
       COALESCE(SUM(s.paid), 0) AS paid_amount,
       COALESCE(SUM(s.due), 0) AS due_amount,
       COALESCE(SUM(s.total), 0) AS total_amount
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     WHERE DATE(s.created_at) BETWEEN ? AND ?
     GROUP BY COALESCE(s.customer_id, CONCAT('phone:', s.customer_phone)), s.customer_phone
     ORDER BY MAX(s.created_at) DESC
     LIMIT ? OFFSET ?`,
    [from, to, pagination.pageSize, pagination.offset],
  );

  return {
    table: {
      key: "customer-report",
      title: "Customer Report",
      columns: ["Date", "Customer", "Phone", "Sell IDs", "Sell", "Paid", "Due Amount", "Total Amount"],
      rows: rows.map((row) => ({
        Date: String(row.report_date ?? ""),
        Customer: String(row.customer_name ?? "Walk-in"),
        Phone: String(row.customer_phone ?? ""),
        "Sell IDs": String(row.sell_ids ?? ""),
        Sell: Number(row.sell_count ?? 0),
        Paid: roundMoney(toNumber(row.paid_amount)),
        "Due Amount": roundMoney(toNumber(row.due_amount)),
        "Total Amount": roundMoney(toNumber(row.total_amount)),
      })),
    },
    pagination,
    extraTables: [],
  };
}

async function buildProfitTable(
  from: string,
  to: string,
  groupBy: GroupBy,
  requestedPage: number,
  requestedPageSize: number,
): Promise<{ table: ReportTable; pagination: PaginationContext; extraTables: ReportTable[] }> {
  if (groupBy === "day") {
    const totalRows = await getTotalRows(
      `SELECT COUNT(*) AS value
       FROM sales
       WHERE DATE(created_at) BETWEEN ? AND ?`,
      [from, to],
    );

    const pagination = buildPaginationContext(totalRows, requestedPage, requestedPageSize);

    const rows = await dbQuery<GenericRow[]>(
      `SELECT
         DATE_FORMAT(s.created_at, '%d-%m-%Y %H:%i') AS report_date,
         s.id AS sale_id,
         COALESCE(s.total, 0) AS sales_amount,
         COALESCE(s.paid, 0) AS sales_amount,
         COALESCE(s.due, 0) AS due_amount,
         COALESCE(p.gross_profit, 0) AS gross_profit,
         CASE
           WHEN s.total > 0 THEN (COALESCE(p.gross_profit, 0) / s.total) * 100
           ELSE 0
         END AS margin_percent
       FROM sales s
       LEFT JOIN (
         SELECT
           si.sale_id,
           COALESCE(SUM((si.sell_price - si.buy_price) * si.quantity), 0) AS gross_profit
         FROM sale_items si
         GROUP BY si.sale_id
       ) p ON p.sale_id = s.id
       WHERE DATE(s.created_at) BETWEEN ? AND ?
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT ? OFFSET ?`,
      [from, to, pagination.pageSize, pagination.offset],
    );

    const dailyRows = await dbQuery<GenericRow[]>(
      `SELECT
         DATE_FORMAT(s.created_at, '%d-%m-%Y') AS report_date,
         COALESCE(SUM(s.total), 0) AS sales_amount,
         COALESCE(SUM(p.gross_profit), 0) AS gross_profit,
         COALESCE(e.expense_total, 0) AS expenses,
         COALESCE(SUM(p.gross_profit), 0) - COALESCE(e.expense_total, 0) AS net_profit,
         CASE
           WHEN COALESCE(SUM(s.total), 0) > 0 THEN (COALESCE(SUM(p.gross_profit), 0) / SUM(s.total)) * 100
           ELSE 0
         END AS margin_percent
       FROM sales s
       LEFT JOIN (
         SELECT
           si.sale_id,
           COALESCE(SUM((si.sell_price - si.buy_price) * si.quantity), 0) AS gross_profit
         FROM sale_items si
         GROUP BY si.sale_id
       ) p ON p.sale_id = s.id
       LEFT JOIN (
         SELECT
           expense_date,
           COALESCE(SUM(amount), 0) AS expense_total
         FROM expenses
         WHERE expense_date BETWEEN ? AND ?
           AND is_deleted = 0
         GROUP BY expense_date
       ) e ON e.expense_date = DATE(s.created_at)
       WHERE DATE(s.created_at) BETWEEN ? AND ?
       GROUP BY DATE(s.created_at), e.expense_total
       ORDER BY report_date DESC
       LIMIT 180`,
      [from, to, from, to],
    );

    return {
      table: {
        key: "profit-report",
        title: "Profit Report",
        columns: ["Date", "Sale ID", "Sales", "Sales amount", "Due", "Profit", "Margin %"],
        rows: rows.map((row) => ({
          Date: String(row.report_date ?? ""),
          "Sale ID": Number(row.sale_id ?? 0),
          Sales: roundMoney(toNumber(row.sales_amount)),
          "Sales amount": roundMoney(toNumber(row.sales_amount)),
          Due: roundMoney(toNumber(row.due_amount)),
          Profit: roundMoney(toNumber(row.gross_profit)),
          "Margin %": roundMoney(toNumber(row.margin_percent)),
        })),
      },
      pagination,
      extraTables: [
        {
          key: "profit-daily-summary",
          title: "Daily Profitability Summary",
          columns: ["Date", "Sales", "Gross Profit", "Expenses", "Net Profit", "Margin %"],
          rows: dailyRows.map((row) => ({
            Date: String(row.report_date ?? ""),
            Sales: roundMoney(toNumber(row.sales_amount)),
            "Gross Profit": roundMoney(toNumber(row.gross_profit)),
            Expenses: roundMoney(toNumber(row.expenses)),
            "Net Profit": roundMoney(toNumber(row.net_profit)),
            "Margin %": roundMoney(toNumber(row.margin_percent)),
          })),
        },
      ],
    };
  }

  const totalRows = await getTotalRows(
    `SELECT COUNT(*) AS value
     FROM (
       SELECT ${monthExpression("created_at")} AS period_month
       FROM sales
       WHERE DATE(created_at) BETWEEN ? AND ?
       GROUP BY ${monthExpression("created_at")}
     ) grouped_rows`,
    [from, to],
  );

  const pagination = buildPaginationContext(totalRows, requestedPage, requestedPageSize);

  const rows = await dbQuery<GenericRow[]>(
    `SELECT
       ${monthExpression("s.created_at")} AS period_month,
       COUNT(*) AS invoices,
       COALESCE(SUM(s.total), 0) AS sales_amount,
      COALESCE(SUM(s.paid), 0) AS sales_amount,
       COALESCE(SUM(s.due), 0) AS due_amount,
       COALESCE(SUM(p.gross_profit), 0) AS gross_profit,
       COALESCE(em.expense_total, 0) AS expenses,
       COALESCE(SUM(p.gross_profit), 0) - COALESCE(em.expense_total, 0) AS net_profit,
       CASE
         WHEN COALESCE(SUM(s.total), 0) > 0 THEN (COALESCE(SUM(p.gross_profit), 0) / SUM(s.total)) * 100
         ELSE 0
       END AS margin_percent
     FROM sales s
     LEFT JOIN (
       SELECT
         si.sale_id,
         COALESCE(SUM((si.sell_price - si.buy_price) * si.quantity), 0) AS gross_profit
       FROM sale_items si
       GROUP BY si.sale_id
     ) p ON p.sale_id = s.id
     LEFT JOIN (
       SELECT
         ${monthExpression("expense_date")} AS period_month,
         COALESCE(SUM(amount), 0) AS expense_total
       FROM expenses
       WHERE expense_date BETWEEN ? AND ?
         AND is_deleted = 0
       GROUP BY ${monthExpression("expense_date")}
     ) em ON em.period_month = ${monthExpression("s.created_at")}
     WHERE DATE(s.created_at) BETWEEN ? AND ?
     GROUP BY ${monthExpression("s.created_at")}, em.expense_total
     ORDER BY period_month DESC
     LIMIT ? OFFSET ?`,
    [from, to, from, to, pagination.pageSize, pagination.offset],
  );

  return {
    table: {
      key: "profit-report",
      title: "Profit Report",
      columns: ["Month", "Sell", "Sales", "Sales amount", "Due", "Gross Profit", "Expenses", "Net Profit", "Margin %"],
      rows: rows.map((row) => ({
        Month: String(row.period_month ?? ""),
        Sell: Number(row.invoices ?? 0),
        Sales: roundMoney(toNumber(row.sales_amount)),
        "Sales amount": roundMoney(toNumber(row.sales_amount)),
        Due: roundMoney(toNumber(row.due_amount)),
        "Gross Profit": roundMoney(toNumber(row.gross_profit)),
        Expenses: roundMoney(toNumber(row.expenses)),
        "Net Profit": roundMoney(toNumber(row.net_profit)),
        "Margin %": roundMoney(toNumber(row.margin_percent)),
      })),
    },
    pagination,
    extraTables: [],
  };
}

async function buildTemplateTable(
  template: TemplateKey,
  from: string,
  to: string,
  groupBy: GroupBy,
  requestedPage: number,
  requestedPageSize: number,
) {
  if (template === "selling") {
    return buildSellingTable(from, to, groupBy, requestedPage, requestedPageSize);
  }

  if (template === "due") {
    return buildDueTable(from, to, groupBy, requestedPage, requestedPageSize);
  }

  if (template === "stock") {
    return buildStockTable(from, to, groupBy, requestedPage, requestedPageSize);
  }

  if (template === "expense") {
    return buildExpenseTable(from, to, groupBy, requestedPage, requestedPageSize);
  }

  if (template === "customer") {
    return buildCustomerTable(from, to, groupBy, requestedPage, requestedPageSize);
  }

  return buildProfitTable(from, to, groupBy, requestedPage, requestedPageSize);
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    await assertPermission(user, "reports", "view");

    const { searchParams } = new URL(request.url);

    const defaults = getDefaultRange();
    const from = searchParams.get("from")?.trim() || defaults.from;
    const to = searchParams.get("to")?.trim() || defaults.to;

    if (!isValidDateInput(from) || !isValidDateInput(to)) {
      throw new ApiError(400, "Invalid date range. Use YYYY-MM-DD");
    }

    if (from > to) {
      throw new ApiError(400, "From date cannot be later than to date");
    }

    const template = parseTemplate(searchParams.get("template"));
    const groupByParam = searchParams.get("groupBy")?.trim();
    const groupBy: GroupBy = groupByParam === "month" ? "month" : "day";
    const requestedPage = parsePage(searchParams.get("page"));
    const requestedPageSize = parsePageSize(searchParams.get("pageSize"));

    const [summary, templateData] = await Promise.all([
      buildRangeSummary(from, to),
      buildTemplateTable(template, from, to, groupBy, requestedPage, requestedPageSize),
    ]);

    const payload: TemplateReportResponse = {
      template,
      range: {
        from,
        to,
        group_by: groupBy,
      },
      summary,
      table: templateData.table,
      extra_tables: templateData.extraTables,
      pagination: toPaginationPayload(templateData.pagination),
    };

    return jsonOk(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
