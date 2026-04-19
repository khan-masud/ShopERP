import type { RowDataPacket } from "mysql2/promise";
import { DashboardShortcuts } from "@/components/dashboard/DashboardShortcuts";
import { StockWarnings } from "@/components/dashboard/StockWarnings";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { dbQuery } from "@/lib/server/db";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserForPage } from "@/lib/server/require-user";
import { formatDateTime } from "@/lib/utils";

interface NumberRow extends RowDataPacket {
  value: string | number;
}

interface RecentSaleRow extends RowDataPacket {
  id: number;
  customer_name: string | null;
  customer_phone: string;
  due: string;
  created_at: Date;
  item_count: number;
  total_quantity: number;
}

interface LowStockRow extends RowDataPacket {
  id: string;
  name: string;
  sku: string;
  stock: number;
  min_stock: number;
}

interface ProductVelocityRow extends RowDataPacket {
  id: string;
  name: string;
  stock: number;
  min_stock: number;
  qty_30d: string;
}

interface CustomerPulseRow extends RowDataPacket {
  id: string;
  name: string | null;
  phone: string;
  sale_count: number;
  qty_total: string;
  last_sale_at: Date | null;
}

interface RefundSummaryRow extends RowDataPacket {
  refund_count: number;
  sales_affected: number;
  units_refunded: string;
}

interface RefundActivityRow extends RowDataPacket {
  id: string;
  sale_id: number;
  refund_note: string | null;
  created_at: Date;
  created_by_name: string | null;
  item_count: number;
  units_refunded: string;
}

type VelocityRisk = "critical" | "high" | "medium" | "safe";

type ProductVelocityView = {
  id: string;
  name: string;
  stock: number;
  minStock: number;
  qty30d: number;
  dailyVelocity: number;
  daysToStockout: number | null;
  risk: VelocityRisk;
};

type DashboardData = {
  dbReady: boolean;
  todaySalesCount: number;
  activeProductsCount: number;
  activeCustomersCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  dueSalesCount: number;
  newCustomers30dCount: number;
  recentSales: RecentSaleRow[];
  lowStockProducts: LowStockRow[];
  lowStockAlertProducts: LowStockRow[];
  outOfStockAlertProducts: LowStockRow[];
  productVelocity: ProductVelocityView[];
  customerPulse: CustomerPulseRow[];
  refundSummary: {
    refundCount: number;
    salesAffected: number;
    unitsRefunded: number;
  };
  refundActivities: RefundActivityRow[];
  refundModuleReady: boolean;
};

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toFixedNumber(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function getVelocityRisk(stock: number, minStock: number, daysToStockout: number | null): VelocityRisk {
  if (stock <= 0) {
    return "critical";
  }

  if (daysToStockout !== null && daysToStockout <= 3) {
    return "critical";
  }

  if (daysToStockout !== null && daysToStockout <= 7) {
    return "high";
  }

  if (daysToStockout !== null && daysToStockout <= 14) {
    return "medium";
  }

  if (stock <= minStock) {
    return "medium";
  }

  return "safe";
}

function velocityRiskClass(risk: VelocityRisk) {
  if (risk === "critical") {
    return "bg-red-100 text-red-700";
  }

  if (risk === "high") {
    return "bg-amber-100 text-amber-700";
  }

  if (risk === "medium") {
    return "bg-orange-100 text-orange-700";
  }

  return "bg-emerald-100 text-emerald-700";
}

function buildEmptyData(): DashboardData {
  return {
    dbReady: false,
    todaySalesCount: 0,
    activeProductsCount: 0,
    activeCustomersCount: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
    dueSalesCount: 0,
    newCustomers30dCount: 0,
    recentSales: [],
    lowStockProducts: [],
    lowStockAlertProducts: [],
    outOfStockAlertProducts: [],
    productVelocity: [],
    customerPulse: [],
    refundSummary: {
      refundCount: 0,
      salesAffected: 0,
      unitsRefunded: 0,
    },
    refundActivities: [],
    refundModuleReady: false,
  };
}

async function getDashboardData(): Promise<DashboardData> {
  try {
    const [
      todaySalesRows,
      activeProductsRows,
      activeCustomersRows,
      lowStockRows,
      outOfStockRows,
      dueSalesRows,
      newCustomersRows,
      recentSales,
      lowStockProducts,
      lowStockAlertProducts,
      outOfStockAlertProducts,
      productVelocityRows,
      customerPulse,
    ] = await Promise.all([
      dbQuery<NumberRow[]>(
        `SELECT COUNT(*) AS value
         FROM sales
         WHERE DATE(created_at) = CURRENT_DATE`,
      ),
      dbQuery<NumberRow[]>(
        `SELECT COUNT(*) AS value
         FROM products
         WHERE is_active = 1`,
      ),
      dbQuery<NumberRow[]>(
        `SELECT COUNT(*) AS value
         FROM customers
         WHERE is_active = 1`,
      ),
      dbQuery<NumberRow[]>(
        `SELECT COUNT(*) AS value
         FROM products
         WHERE is_active = 1
           AND stock <= min_stock`,
      ),
      dbQuery<NumberRow[]>(
        `SELECT COUNT(*) AS value
         FROM products
         WHERE is_active = 1
           AND stock <= 0`,
      ),
      dbQuery<NumberRow[]>(
        `SELECT COUNT(*) AS value
         FROM sales
         WHERE due > 0`,
      ),
      dbQuery<NumberRow[]>(
        `SELECT COUNT(*) AS value
         FROM customers
         WHERE is_active = 1
           AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      ),
      dbQuery<RecentSaleRow[]>(
        `SELECT
           s.id,
           s.customer_name,
           s.customer_phone,
           s.due,
           s.created_at,
           COALESCE(si.item_count, 0) AS item_count,
           COALESCE(si.total_quantity, 0) AS total_quantity
         FROM sales s
         LEFT JOIN (
           SELECT
             sale_id,
             COALESCE(SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END), 0) AS item_count,
             COALESCE(SUM(quantity), 0) AS total_quantity
           FROM sale_items
           GROUP BY sale_id
         ) si ON si.sale_id = s.id
         ORDER BY s.created_at DESC
         LIMIT 8`,
      ),
      dbQuery<LowStockRow[]>(
        `SELECT id, name, sku, stock, min_stock
         FROM products
         WHERE is_active = 1
           AND stock <= min_stock
         ORDER BY stock ASC, min_stock DESC, name ASC
         LIMIT 12`,
      ),
      dbQuery<LowStockRow[]>(
        `SELECT id, name, sku, stock, min_stock
         FROM products
         WHERE is_active = 1
           AND stock > 0
           AND stock <= min_stock
         ORDER BY stock ASC, min_stock DESC, name ASC
         LIMIT 50`,
      ),
      dbQuery<LowStockRow[]>(
        `SELECT id, name, sku, stock, min_stock
         FROM products
         WHERE is_active = 1
           AND stock <= 0
         ORDER BY name ASC
         LIMIT 50`,
      ),
      dbQuery<ProductVelocityRow[]>(
        `SELECT
           p.id,
           p.name,
           p.stock,
           p.min_stock,
           COALESCE(v.qty_30d, 0) AS qty_30d
         FROM products p
         LEFT JOIN (
           SELECT
             si.product_id,
             COALESCE(SUM(si.quantity), 0) AS qty_30d
           FROM sale_items si
           INNER JOIN sales s ON s.id = si.sale_id
           WHERE s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           GROUP BY si.product_id
         ) v ON v.product_id = p.id
         WHERE p.is_active = 1
         ORDER BY COALESCE(v.qty_30d, 0) DESC, p.stock ASC
         LIMIT 12`,
      ),
      dbQuery<CustomerPulseRow[]>(
        `SELECT
           c.id,
           c.name,
           c.phone,
           COALESCE(cs.sale_count, 0) AS sale_count,
           COALESCE(cs.qty_total, 0) AS qty_total,
           cs.last_sale_at
         FROM customers c
         LEFT JOIN (
           SELECT
             s.customer_id,
             COUNT(*) AS sale_count,
             COALESCE(SUM(si.quantity), 0) AS qty_total,
             MAX(s.created_at) AS last_sale_at
           FROM sales s
           LEFT JOIN sale_items si ON si.sale_id = s.id
           WHERE s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             AND s.customer_id IS NOT NULL
           GROUP BY s.customer_id
         ) cs ON cs.customer_id = c.id
         WHERE c.is_active = 1
         ORDER BY COALESCE(cs.sale_count, 0) DESC, COALESCE(cs.last_sale_at, '1970-01-01') DESC
         LIMIT 8`,
      ),
    ]);

    let refundSummary = {
      refundCount: 0,
      salesAffected: 0,
      unitsRefunded: 0,
    };
    let refundActivities: RefundActivityRow[] = [];
    let refundModuleReady = true;

    try {
      const [refundSummaryRows, refundActivityRows] = await Promise.all([
        dbQuery<RefundSummaryRow[]>(
          `SELECT
             COUNT(DISTINCT sr.id) AS refund_count,
             COUNT(DISTINCT sr.sale_id) AS sales_affected,
             COALESCE(SUM(sri.quantity), 0) AS units_refunded
           FROM sale_refunds sr
           LEFT JOIN sale_refund_items sri ON sri.refund_id = sr.id
           WHERE sr.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        ),
        dbQuery<RefundActivityRow[]>(
          `SELECT
             sr.id,
             sr.sale_id,
             sr.refund_note,
             sr.created_at,
             u.name AS created_by_name,
             COALESCE(COUNT(sri.id), 0) AS item_count,
             COALESCE(SUM(sri.quantity), 0) AS units_refunded
           FROM sale_refunds sr
           LEFT JOIN sale_refund_items sri ON sri.refund_id = sr.id
           LEFT JOIN users u ON u.id = sr.created_by
           WHERE sr.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           GROUP BY sr.id, sr.sale_id, sr.refund_note, sr.created_at, u.name
           ORDER BY sr.created_at DESC
           LIMIT 8`,
        ),
      ]);

      const summaryRow = refundSummaryRows[0];
      refundSummary = {
        refundCount: Number(summaryRow?.refund_count ?? 0),
        salesAffected: Number(summaryRow?.sales_affected ?? 0),
        unitsRefunded: toNumber(summaryRow?.units_refunded),
      };
      refundActivities = refundActivityRows;
    } catch {
      refundModuleReady = false;
    }

    const productVelocity = productVelocityRows.map((row) => {
      const qty30d = toNumber(row.qty_30d);
      const dailyVelocity = qty30d > 0 ? toFixedNumber(qty30d / 30) : 0;
      const rawDaysToStockout = dailyVelocity > 0 ? row.stock / dailyVelocity : null;
      const daysToStockout =
        rawDaysToStockout !== null && Number.isFinite(rawDaysToStockout)
          ? toFixedNumber(rawDaysToStockout)
          : null;

      return {
        id: row.id,
        name: row.name,
        stock: Number(row.stock ?? 0),
        minStock: Number(row.min_stock ?? 0),
        qty30d,
        dailyVelocity,
        daysToStockout,
        risk: getVelocityRisk(Number(row.stock ?? 0), Number(row.min_stock ?? 0), daysToStockout),
      } satisfies ProductVelocityView;
    });

    return {
      dbReady: true,
      todaySalesCount: Number(todaySalesRows[0]?.value ?? 0),
      activeProductsCount: Number(activeProductsRows[0]?.value ?? 0),
      activeCustomersCount: Number(activeCustomersRows[0]?.value ?? 0),
      lowStockCount: Number(lowStockRows[0]?.value ?? 0),
      outOfStockCount: Number(outOfStockRows[0]?.value ?? 0),
      dueSalesCount: Number(dueSalesRows[0]?.value ?? 0),
      newCustomers30dCount: Number(newCustomersRows[0]?.value ?? 0),
      recentSales,
      lowStockProducts,
      lowStockAlertProducts,
      outOfStockAlertProducts,
      productVelocity,
      customerPulse,
      refundSummary,
      refundActivities,
      refundModuleReady,
    };
  } catch {
    return buildEmptyData();
  }
}

export default async function DashboardPage() {
  const user = await requireUserForPage();
  await assertPermission(user, "dashboard", "view");
  const data = await getDashboardData();

  return (
    <div className="space-y-6">
      {!data.dbReady ? (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Database is not configured yet. Apply the schema and run the admin seed first.
        </Card>
      ) : null}

      {data.dbReady ? (
        <StockWarnings
          lowStockProducts={data.lowStockAlertProducts}
          outOfStockProducts={data.outOfStockAlertProducts}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Today Sales Count" value={String(data.todaySalesCount)} accent="blue" />
        <StatCard title="Active Products" value={String(data.activeProductsCount)} accent="green" />
        <StatCard title="Active Customers" value={String(data.activeCustomersCount)} accent="blue" />
        <StatCard title="Low Stock Items" value={String(data.lowStockCount)} accent="red" />
        <StatCard title="Out Of Stock" value={String(data.outOfStockCount)} accent="red" />
        <StatCard title="Sales With Due" value={String(data.dueSalesCount)} accent="orange" />
        <StatCard title="New Customers (30d)" value={String(data.newCustomers30dCount)} accent="green" />
        <StatCard title="Refund Events (30d)" value={String(data.refundSummary.refundCount)} accent="orange" />
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-900">Quick Shortcuts</h3>
        <p className="mt-1 text-xs text-slate-500">
          Fast actions for day-to-day operations from dashboard.
        </p>
        <div className="mt-4">
          <DashboardShortcuts />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Recent Sales</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Sale</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-right">Lines / Qty</th>
                  <th className="px-3 py-2 text-left">Due Status</th>
                  <th className="px-3 py-2 text-left">Time</th>
                </tr>
              </thead>
              <tbody>
                {data.recentSales.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                      No sales yet.
                    </td>
                  </tr>
                ) : (
                  data.recentSales.map((sale) => (
                    <tr key={sale.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-900">#{sale.id}</td>
                      <td className="px-3 py-2 text-slate-700">
                        <p>{sale.customer_name || "Walk-in"}</p>
                        <p className="text-xs text-slate-500">{sale.customer_phone}</p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {sale.item_count} / {sale.total_quantity}
                      </td>
                      <td className="px-3 py-2">
                        {toNumber(sale.due) > 0 ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            Due Pending
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            Cleared
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(sale.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Low Stock Watchlist</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-right">Stock</th>
                  <th className="px-3 py-2 text-right">Min</th>
                </tr>
              </thead>
              <tbody>
                {data.lowStockProducts.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
                      No low stock item right now.
                    </td>
                  </tr>
                ) : (
                  data.lowStockProducts.map((item) => (
                    <tr key={item.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{item.name}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{item.sku}</td>
                      <td
                        className={
                          item.stock <= 0
                            ? "px-3 py-2 text-right tabular-nums text-red-700"
                            : "px-3 py-2 text-right tabular-nums text-amber-700"
                        }
                      >
                        {item.stock}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{item.min_stock}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Product Velocity Snapshot (30 Days)</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-right">Sold 30d</th>
                  <th className="px-3 py-2 text-right">Stock</th>
                  <th className="px-3 py-2 text-right">Stockout ETA</th>
                  <th className="px-3 py-2 text-right">Risk</th>
                </tr>
              </thead>
              <tbody>
                {data.productVelocity.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                      No product velocity data yet.
                    </td>
                  </tr>
                ) : (
                  data.productVelocity.map((item) => (
                    <tr key={item.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{item.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{item.qty30d}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{item.stock}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {item.daysToStockout === null ? "No trend" : `${item.daysToStockout.toFixed(1)}d`}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${velocityRiskClass(item.risk)}`}>
                          {item.risk}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Customer Activity (30 Days)</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-right">Sales</th>
                  <th className="px-3 py-2 text-right">Units</th>
                  <th className="px-3 py-2 text-left">Last Sale</th>
                </tr>
              </thead>
              <tbody>
                {data.customerPulse.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
                      No customer activity yet.
                    </td>
                  </tr>
                ) : (
                  data.customerPulse.map((customer) => (
                    <tr key={customer.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">
                        <p>{customer.name || "Unnamed"}</p>
                        <p className="text-xs text-slate-500">{customer.phone}</p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{customer.sale_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{toNumber(customer.qty_total)}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {customer.last_sale_at ? formatDateTime(customer.last_sale_at) : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div>
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Refund Activity (30 Days)</h3>
          </div>

          {!data.refundModuleReady ? (
            <div className="px-4 py-5 text-sm text-amber-700">
              Refund module not ready yet. Apply latest migration to enable refund analytics.
            </div>
          ) : (
            <>
              <div className="grid gap-3 border-b border-slate-200 px-4 py-3 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Refund Events</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
                    {data.refundSummary.refundCount}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sales Affected</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
                    {data.refundSummary.salesAffected}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Units Refunded</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
                    {data.refundSummary.unitsRefunded}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Refund</th>
                      <th className="px-3 py-2 text-left">Sale</th>
                      <th className="px-3 py-2 text-right">Items / Units</th>
                      <th className="px-3 py-2 text-left">By</th>
                      <th className="px-3 py-2 text-left">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.refundActivities.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                          No refund activity in the last 30 days.
                        </td>
                      </tr>
                    ) : (
                      data.refundActivities.map((refund) => (
                        <tr key={refund.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-xs font-medium text-slate-700">{refund.id.slice(0, 8)}</td>
                          <td className="px-3 py-2 text-slate-700">#{refund.sale_id}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {refund.item_count} / {toNumber(refund.units_refunded)}
                          </td>
                          <td className="px-3 py-2 text-slate-700">{refund.created_by_name || "System"}</td>
                          <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(refund.created_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
