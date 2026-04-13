import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { roundMoney } from "@/lib/server/crypto";
import { dbQuery } from "@/lib/server/db";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

interface CurrentDateRow extends RowDataPacket {
  today_date: string | Date;
  current_month: string;
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

interface OutstandingDueRow extends RowDataPacket {
  outstanding_due: string;
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

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDayKey(value: string | Date) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function normalizeMonthKey(value: string | Date) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 7);
  }

  return String(value).slice(0, 7);
}

function parseDayKey(dayKey: string) {
  const [yearText, monthText, dayText] = dayKey.split("-");
  return new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
}

function parseMonthKey(monthKey: string) {
  const [yearText, monthText] = monthKey.split("-");
  return new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1));
}

function formatDayKey(date: Date) {
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

function buildDayKeys(endDayKey: string, days: number) {
  const endDate = parseDayKey(endDayKey);
  const keys: string[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(endDate);
    date.setUTCDate(endDate.getUTCDate() - offset);
    keys.push(formatDayKey(date));
  }

  return keys;
}

function buildMonthKeys(endMonthKey: string, months: number) {
  const endMonthDate = parseMonthKey(endMonthKey);
  const keys: string[] = [];

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(endMonthDate);
    date.setUTCMonth(endMonthDate.getUTCMonth() - offset);
    keys.push(formatMonthKey(date));
  }

  return keys;
}

function parseWindow(input: string | null, min: number, max: number, fallback: number) {
  const parsed = Number(input ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const safe = Math.floor(parsed);
  return Math.min(Math.max(safe, min), max);
}

function buildTrend(
  keys: string[],
  salesRows: SalesPeriodRow[],
  profitRows: ProfitPeriodRow[],
  dueCollectedRows: DueCollectedPeriodRow[],
  expenseRows: ExpensePeriodRow[],
  periodType: "day" | "month",
) {
  const salesMap = new Map<string, SalesPeriodRow>();
  for (const row of salesRows) {
    const key = periodType === "day" ? normalizeDayKey(row.period) : normalizeMonthKey(row.period);
    salesMap.set(key, row);
  }

  const profitMap = new Map<string, ProfitPeriodRow>();
  for (const row of profitRows) {
    const key = periodType === "day" ? normalizeDayKey(row.period) : normalizeMonthKey(row.period);
    profitMap.set(key, row);
  }

  const dueCollectedMap = new Map<string, DueCollectedPeriodRow>();
  for (const row of dueCollectedRows) {
    const key = periodType === "day" ? normalizeDayKey(row.period) : normalizeMonthKey(row.period);
    dueCollectedMap.set(key, row);
  }

  const expenseMap = new Map<string, ExpensePeriodRow>();
  for (const row of expenseRows) {
    const key = periodType === "day" ? normalizeDayKey(row.period) : normalizeMonthKey(row.period);
    expenseMap.set(key, row);
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
    const dayWindow = parseWindow(searchParams.get("days"), 7, 90, 30);
    const monthWindow = parseWindow(searchParams.get("months"), 3, 24, 12);

    const currentRows = await dbQuery<CurrentDateRow[]>(
      `SELECT CURRENT_DATE() AS today_date, DATE_FORMAT(CURRENT_DATE(), '%Y-%m') AS current_month`,
    );

    const currentDayKey = normalizeDayKey(currentRows[0]?.today_date ?? new Date());
    const currentMonthKey = currentRows[0]?.current_month ?? normalizeMonthKey(new Date());

    const dayKeys = buildDayKeys(currentDayKey, dayWindow);
    const dayStart = dayKeys[0];
    const dayEnd = dayKeys[dayKeys.length - 1];

    const monthKeys = buildMonthKeys(currentMonthKey, monthWindow);
    const monthStartDate = `${monthKeys[0]}-01`;

    const monthEndExclusiveDateObj = parseMonthKey(monthKeys[monthKeys.length - 1]);
    monthEndExclusiveDateObj.setUTCMonth(monthEndExclusiveDateObj.getUTCMonth() + 1);
    const monthEndExclusiveDate = `${formatMonthKey(monthEndExclusiveDateObj)}-01`;

    const [
      salesDailyRows,
      profitDailyRows,
      dueCollectedDailyRows,
      expenseDailyRows,
      salesMonthlyRows,
      profitMonthlyRows,
      dueCollectedMonthlyRows,
      expenseMonthlyRows,
      outstandingDueRows,
    ] = await Promise.all([
      dbQuery<SalesPeriodRow[]>(
        `SELECT
           DATE(created_at) AS period,
           COUNT(*) AS sale_count,
           COALESCE(SUM(total), 0) AS sales_total,
           COALESCE(SUM(due), 0) AS due_total
         FROM sales
         WHERE DATE(created_at) BETWEEN ? AND ?
         GROUP BY DATE(created_at)
         ORDER BY period ASC`,
        [dayStart, dayEnd],
      ),
      dbQuery<ProfitPeriodRow[]>(
        `SELECT
           DATE(s.created_at) AS period,
           COALESCE(SUM((si.sell_price - si.buy_price) * si.quantity), 0) AS gross_profit
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         WHERE DATE(s.created_at) BETWEEN ? AND ?
         GROUP BY DATE(s.created_at)
         ORDER BY period ASC`,
        [dayStart, dayEnd],
      ),
      dbQuery<DueCollectedPeriodRow[]>(
        `SELECT
           DATE(created_at) AS period,
           COALESCE(SUM(amount), 0) AS due_collected
         FROM due_payments
         WHERE DATE(created_at) BETWEEN ? AND ?
         GROUP BY DATE(created_at)
         ORDER BY period ASC`,
        [dayStart, dayEnd],
      ),
      dbQuery<ExpensePeriodRow[]>(
        `SELECT
           DATE(expense_date) AS period,
           COALESCE(SUM(amount), 0) AS expense_total
         FROM expenses
         WHERE expense_date BETWEEN ? AND ? AND is_deleted = 0
         GROUP BY DATE(expense_date)
         ORDER BY period ASC`,
        [dayStart, dayEnd],
      ),
      dbQuery<SalesPeriodRow[]>(
        `SELECT
           DATE_FORMAT(created_at, '%Y-%m') AS period,
           COUNT(*) AS sale_count,
           COALESCE(SUM(total), 0) AS sales_total,
           COALESCE(SUM(due), 0) AS due_total
         FROM sales
         WHERE created_at >= ? AND created_at < ?
         GROUP BY DATE_FORMAT(created_at, '%Y-%m')
         ORDER BY period ASC`,
        [monthStartDate, monthEndExclusiveDate],
      ),
      dbQuery<ProfitPeriodRow[]>(
        `SELECT
           DATE_FORMAT(s.created_at, '%Y-%m') AS period,
           COALESCE(SUM((si.sell_price - si.buy_price) * si.quantity), 0) AS gross_profit
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         WHERE s.created_at >= ? AND s.created_at < ?
         GROUP BY DATE_FORMAT(s.created_at, '%Y-%m')
         ORDER BY period ASC`,
        [monthStartDate, monthEndExclusiveDate],
      ),
      dbQuery<DueCollectedPeriodRow[]>(
        `SELECT
           DATE_FORMAT(created_at, '%Y-%m') AS period,
           COALESCE(SUM(amount), 0) AS due_collected
         FROM due_payments
         WHERE created_at >= ? AND created_at < ?
         GROUP BY DATE_FORMAT(created_at, '%Y-%m')
         ORDER BY period ASC`,
        [monthStartDate, monthEndExclusiveDate],
      ),
      dbQuery<ExpensePeriodRow[]>(
        `SELECT
           DATE_FORMAT(expense_date, '%Y-%m') AS period,
           COALESCE(SUM(amount), 0) AS expense_total
         FROM expenses
         WHERE expense_date >= ? AND expense_date < ? AND is_deleted = 0
         GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
         ORDER BY period ASC`,
        [monthStartDate, monthEndExclusiveDate],
      ),
      dbQuery<OutstandingDueRow[]>(
        `SELECT COALESCE(SUM(due), 0) AS outstanding_due
         FROM customers
         WHERE is_active = 1`,
      ),
    ]);

    const dailyTrend = buildTrend(
      dayKeys,
      salesDailyRows,
      profitDailyRows,
      dueCollectedDailyRows,
      expenseDailyRows,
      "day",
    );

    const monthlyTrend = buildTrend(
      monthKeys,
      salesMonthlyRows,
      profitMonthlyRows,
      dueCollectedMonthlyRows,
      expenseMonthlyRows,
      "month",
    );

    const dailySummary = dailyTrend[dailyTrend.length - 1] ?? {
      period: currentDayKey,
      sale_count: 0,
      sales_total: 0,
      due_total: 0,
      due_collected: 0,
      expense_total: 0,
      gross_profit: 0,
      net_profit: 0,
    };

    const monthlySummary = monthlyTrend[monthlyTrend.length - 1] ?? {
      period: currentMonthKey,
      sale_count: 0,
      sales_total: 0,
      due_total: 0,
      due_collected: 0,
      expense_total: 0,
      gross_profit: 0,
      net_profit: 0,
    };

    return jsonOk({
      generated_at: new Date().toISOString(),
      outstanding_due: roundMoney(toNumber(outstandingDueRows[0]?.outstanding_due)),
      daily_summary: dailySummary,
      monthly_summary: monthlySummary,
      daily_trend: dailyTrend,
      monthly_trend: monthlyTrend,
      meta: {
        day_window: dayWindow,
        month_window: monthWindow,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
