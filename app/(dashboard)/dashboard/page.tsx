import type { RowDataPacket } from "mysql2/promise";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { dbQuery } from "@/lib/server/db";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserForPage } from "@/lib/server/require-user";
import { formatDateTime, formatTaka } from "@/lib/utils";

interface NumberRow extends RowDataPacket {
  value: string;
}

interface RecentSaleRow extends RowDataPacket {
  id: number;
  customer_phone: string;
  customer_name: string | null;
  total: string;
  paid: string;
  due: string;
  created_at: Date;
}

async function getDashboardData() {
  try {
    const [todayRevenueRows, todayProfitRows, dueRows, lowStockRows, recentSales] =
      await Promise.all([
        dbQuery<NumberRow[]>(
          `SELECT COALESCE(SUM(total), 0) AS value
           FROM sales
           WHERE DATE(created_at) = CURRENT_DATE`,
        ),
        dbQuery<NumberRow[]>(
          `SELECT COALESCE(SUM((si.sell_price - si.buy_price) * si.quantity), 0) AS value
           FROM sale_items si
           INNER JOIN sales s ON s.id = si.sale_id
           WHERE DATE(s.created_at) = CURRENT_DATE`,
        ),
        dbQuery<NumberRow[]>(
          `SELECT COALESCE(SUM(due), 0) AS value
           FROM customers
           WHERE is_active = 1`,
        ),
        dbQuery<NumberRow[]>(
          `SELECT COUNT(*) AS value
           FROM products
           WHERE is_active = 1 AND stock <= min_stock`,
        ),
        dbQuery<RecentSaleRow[]>(
          `SELECT id, customer_phone, customer_name, total, paid, due, created_at
           FROM sales
           ORDER BY created_at DESC
           LIMIT 8`,
        ),
      ]);

    return {
      todayRevenue: Number(todayRevenueRows[0]?.value ?? 0),
      todayProfit: Number(todayProfitRows[0]?.value ?? 0),
      outstandingDue: Number(dueRows[0]?.value ?? 0),
      lowStockCount: Number(lowStockRows[0]?.value ?? 0),
      recentSales,
      dbReady: true,
    };
  } catch {
    return {
      todayRevenue: 0,
      todayProfit: 0,
      outstandingDue: 0,
      lowStockCount: 0,
      recentSales: [] as RecentSaleRow[],
      dbReady: false,
    };
  }
}

export default async function DashboardPage() {
  const user = await requireUserForPage();
  await assertPermission(user, "dashboard", "view");
  const data = await getDashboardData();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Business Overview</h2>
          <p className="text-sm text-slate-500">Today sales, profit, and stock status</p>
        </div>
      </div>

      {!data.dbReady ? (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Database is not configured yet. Apply the schema and run the admin seed first.
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Today Revenue"
          value={formatTaka(data.todayRevenue)}
          accent="blue"
          hint="Total sales today"
        />
        <StatCard
          title="Today Profit"
          value={formatTaka(data.todayProfit)}
          accent="green"
          hint="Gross margin"
        />
        <StatCard
          title="Outstanding Due"
          value={formatTaka(data.outstandingDue)}
          accent="orange"
          hint="Customer dues"
        />
        <StatCard
          title="Low Stock Items"
          value={String(data.lowStockCount)}
          accent="red"
          hint="Stock alerts"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Recent Sales</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Sale ID</th>
                <th className="px-4 py-2 text-left">Customer</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2 text-right">Paid</th>
                <th className="px-4 py-2 text-right">Due</th>
                <th className="px-4 py-2 text-left">Time</th>
              </tr>
            </thead>
            <tbody>
              {data.recentSales.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>
                    No sales yet.
                  </td>
                </tr>
              ) : (
                data.recentSales.map((sale) => (
                  <tr key={sale.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-900">#{sale.id}</td>
                    <td className="px-4 py-2 text-slate-700">
                      {sale.customer_name || "Walk-in"} ({sale.customer_phone})
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatTaka(sale.total)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatTaka(sale.paid)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-700">
                      {formatTaka(sale.due)}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(sale.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
