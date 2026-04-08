import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { roundMoney } from "@/lib/server/crypto";
import { dbQuery } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

interface SalesSummaryRow extends RowDataPacket {
  sale_count: number;
  sales_total: string;
  due_total: string;
}

interface NumberValueRow extends RowDataPacket {
  value: string;
}

interface SalesPeriodRow extends RowDataPacket {
  period: string | Date;
  sale_count: number;
  sales_total: string;
  due_total: string;
}

interface ProfitPeriodRow extends RowDataPacket {
  period: string | Date;
  gross_profit: string;
}

interface DueCollectedPeriodRow extends RowDataPacket {
  period: string | Date;
  due_collected: string;
}

interface ExpensePeriodRow extends RowDataPacket {
  period: string | Date;
  expense_total: string;
}

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

type GroupBy = "day" | "month";

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function parseDayKey(input: string) {
  const [yearText, monthText, dayText] = input.split("-");
  return new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
}

function parseMonthKey(input: string) {
  const [yearText, monthText] = input.split("-");
  return new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1));
}

function normalizeDayKey(value: string | Date) {
  if (value instanceof Date) {
    return formatDateKey(value);
  }

  return String(value).slice(0, 10);
}

function normalizeMonthKey(value: string | Date) {
  if (value instanceof Date) {
    return formatMonthKey(value);
  }

  return String(value).slice(0, 7);
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

function getDefaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 29);

  return {
    from: formatDateKey(start),
    to: formatDateKey(end),
  };
}

function buildDayKeys(fromDate: string, toDate: string) {
  const from = parseDayKey(fromDate);
  const to = parseDayKey(toDate);
  const keys: string[] = [];

  for (let current = new Date(from); current <= to; current.setUTCDate(current.getUTCDate() + 1)) {
    keys.push(formatDateKey(current));
  }

  return keys;
}

function buildMonthKeys(fromDate: string, toDate: string) {
  const from = parseMonthKey(fromDate.slice(0, 7));
  const to = parseMonthKey(toDate.slice(0, 7));
  const keys: string[] = [];

  for (let current = new Date(from); current <= to; current.setUTCMonth(current.getUTCMonth() + 1)) {
    keys.push(formatMonthKey(current));
  }

  return keys;
}

function buildTrend(
  keys: string[],
  salesRows: SalesPeriodRow[],
  profitRows: ProfitPeriodRow[],
  dueCollectedRows: DueCollectedPeriodRow[],
  expenseRows: ExpensePeriodRow[],
  groupBy: GroupBy,
) {
  const keyOf = (value: string | Date) =>
    groupBy === "day" ? normalizeDayKey(value) : normalizeMonthKey(value);

  const salesMap = new Map<string, SalesPeriodRow>();
  for (const row of salesRows) {
    salesMap.set(keyOf(row.period), row);
  }

  const profitMap = new Map<string, ProfitPeriodRow>();
  for (const row of profitRows) {
    profitMap.set(keyOf(row.period), row);
  }

  const dueCollectedMap = new Map<string, DueCollectedPeriodRow>();
  for (const row of dueCollectedRows) {
    dueCollectedMap.set(keyOf(row.period), row);
  }

  const expenseMap = new Map<string, ExpensePeriodRow>();
  for (const row of expenseRows) {
    expenseMap.set(keyOf(row.period), row);
  }

  const trend: TrendPoint[] = [];

  for (const key of keys) {
    const salesRow = salesMap.get(key);
    const profitRow = profitMap.get(key);
    const dueCollectedRow = dueCollectedMap.get(key);
    const expenseRow = expenseMap.get(key);

    const salesTotal = roundMoney(toNumber(salesRow?.sales_total));
    const dueTotal = roundMoney(toNumber(salesRow?.due_total));
    const dueCollected = roundMoney(toNumber(dueCollectedRow?.due_collected));
    const expenseTotal = roundMoney(toNumber(expenseRow?.expense_total));
    const grossProfit = roundMoney(toNumber(profitRow?.gross_profit));
    const netProfit = roundMoney(grossProfit - expenseTotal);

    trend.push({
      period: key,
      sale_count: Number(salesRow?.sale_count ?? 0),
      sales_total: salesTotal,
      due_total: dueTotal,
      due_collected: dueCollected,
      expense_total: expenseTotal,
      gross_profit: grossProfit,
      net_profit: netProfit,
    });
  }

  return trend;
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

    const groupByParam = searchParams.get("groupBy")?.trim();
    const groupBy: GroupBy = groupByParam === "month" ? "month" : "day";

    const salesPeriodExpr =
      groupBy === "day" ? "DATE(created_at)" : "DATE_FORMAT(created_at, '%Y-%m')";
    const profitPeriodExpr =
      groupBy === "day" ? "DATE(s.created_at)" : "DATE_FORMAT(s.created_at, '%Y-%m')";
    const duePeriodExpr =
      groupBy === "day" ? "DATE(created_at)" : "DATE_FORMAT(created_at, '%Y-%m')";
    const expensePeriodExpr =
      groupBy === "day" ? "DATE(expense_date)" : "DATE_FORMAT(expense_date, '%Y-%m')";

    const [
      salesSummaryRows,
      grossProfitRows,
      dueCollectedRows,
      expenseRows,
      outstandingDueRows,
      salesTrendRows,
      profitTrendRows,
      dueCollectedTrendRows,
      expenseTrendRows,
    ] = await Promise.all([
      dbQuery<SalesSummaryRow[]>(
        `SELECT
           COUNT(*) AS sale_count,
           COALESCE(SUM(total), 0) AS sales_total,
           COALESCE(SUM(due), 0) AS due_total
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
         WHERE expense_date BETWEEN ? AND ?`,
        [from, to],
      ),
      dbQuery<NumberValueRow[]>(
        `SELECT COALESCE(SUM(due), 0) AS value
         FROM customers
         WHERE is_active = 1`,
      ),
      dbQuery<SalesPeriodRow[]>(
        `SELECT
           ${salesPeriodExpr} AS period,
           COUNT(*) AS sale_count,
           COALESCE(SUM(total), 0) AS sales_total,
           COALESCE(SUM(due), 0) AS due_total
         FROM sales
         WHERE DATE(created_at) BETWEEN ? AND ?
         GROUP BY ${salesPeriodExpr}
         ORDER BY period ASC`,
        [from, to],
      ),
      dbQuery<ProfitPeriodRow[]>(
        `SELECT
           ${profitPeriodExpr} AS period,
           COALESCE(SUM((si.sell_price - si.buy_price) * si.quantity), 0) AS gross_profit
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         WHERE DATE(s.created_at) BETWEEN ? AND ?
         GROUP BY ${profitPeriodExpr}
         ORDER BY period ASC`,
        [from, to],
      ),
      dbQuery<DueCollectedPeriodRow[]>(
        `SELECT
           ${duePeriodExpr} AS period,
           COALESCE(SUM(amount), 0) AS due_collected
         FROM due_payments
         WHERE DATE(created_at) BETWEEN ? AND ?
         GROUP BY ${duePeriodExpr}
         ORDER BY period ASC`,
        [from, to],
      ),
      dbQuery<ExpensePeriodRow[]>(
        `SELECT
           ${expensePeriodExpr} AS period,
           COALESCE(SUM(amount), 0) AS expense_total
         FROM expenses
         WHERE expense_date BETWEEN ? AND ?
         GROUP BY ${expensePeriodExpr}
         ORDER BY period ASC`,
        [from, to],
      ),
    ]);

    const keys =
      groupBy === "day" ? buildDayKeys(from, to) : buildMonthKeys(from, to);

    const trend = buildTrend(
      keys,
      salesTrendRows,
      profitTrendRows,
      dueCollectedTrendRows,
      expenseTrendRows,
      groupBy,
    );

    const summarySales = salesSummaryRows[0];
    const salesTotal = roundMoney(toNumber(summarySales?.sales_total));
    const dueTotal = roundMoney(toNumber(summarySales?.due_total));
    const dueCollected = roundMoney(toNumber(dueCollectedRows[0]?.value));
    const expenseTotal = roundMoney(toNumber(expenseRows[0]?.value));
    const grossProfit = roundMoney(toNumber(grossProfitRows[0]?.value));
    const netProfit = roundMoney(grossProfit - expenseTotal);

    return jsonOk({
      range: {
        from,
        to,
        group_by: groupBy,
      },
      summary: {
        sale_count: Number(summarySales?.sale_count ?? 0),
        sales_total: salesTotal,
        due_total: dueTotal,
        due_collected: dueCollected,
        expense_total: expenseTotal,
        gross_profit: grossProfit,
        net_profit: netProfit,
        outstanding_due: roundMoney(toNumber(outstandingDueRows[0]?.value)),
      },
      trend,
      meta: {
        points: trend.length,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
