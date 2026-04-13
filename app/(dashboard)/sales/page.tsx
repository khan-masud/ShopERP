"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { StatCard } from "@/components/ui/StatCard";
import { formatDateTime, formatTaka } from "@/lib/utils";

type SalesSummary = {
  sale_count: number;
  gross_total: string;
  total_paid: string;
  total_due: string;
};

type SaleListItem = {
  id: number;
  customer_name: string | null;
  customer_phone: string;
  subtotal: string;
  discount_percent: string;
  total: string;
  paid: string;
  due: string;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
  item_count: number;
  total_quantity: number;
  refund_count: number;
  refunded_quantity: string;
};

type RefundFilter = "all" | "refundable" | "refunded";

type SaleDetailItem = {
  id: number;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string;
  customer_address: string | null;
  subtotal: string;
  discount_percent: string;
  total: string;
  tendered: string;
  paid: string;
  due: string;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
  customer_type: "VIP" | "Regular" | "Wholesale" | null;
  customer_due: string | null;
  loyalty_points: number | null;
};

type SaleItem = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  buy_price: string;
  sell_price: string;
  total: string;
  created_at: string;
};

type DuePayment = {
  id: string;
  amount: string;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
};

type RefundItem = {
  id: string;
  refund_id: string;
  sale_item_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  gross_total: string;
  refund_total: string;
  created_at: string;
};

type SaleRefund = {
  id: string;
  refund_note: string | null;
  gross_amount: string;
  refund_amount: string;
  created_at: string;
  created_by_name: string | null;
  items: RefundItem[];
};

type SaleDetailResponse = {
  sale: SaleDetailItem;
  items: SaleItem[];
  due_payments: DuePayment[];
  payment_summary: {
    total_due_paid: string;
  };
  refunds: SaleRefund[];
  refund_summary: {
    refund_count: number;
    units_refunded: string;
    gross_refunded: string;
    amount_refunded: string;
  };
};

type SalesListResponse = {
  sales: SaleListItem[];
  summary: SalesSummary;
  pagination: {
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
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

function parseNumber(value: string | number | null | undefined) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function resolveRefundBadge(sale: SaleListItem) {
  const totalQty = parseNumber(sale.total_quantity);
  const refundedQty = parseNumber(sale.refunded_quantity);
  const remainingQty = Math.max(totalQty - refundedQty, 0);

  if (refundedQty > 0 && remainingQty <= 0) {
    return {
      label: "Refunded",
      className: "bg-red-100 text-red-700",
    };
  }

  if (refundedQty > 0 && remainingQty > 0) {
    return {
      label: "Partially Refunded",
      className: "bg-amber-100 text-amber-700",
    };
  }

  if (remainingQty > 0) {
    return {
      label: "Refundable",
      className: "bg-blue-100 text-blue-700",
    };
  }

  return {
    label: "Not Refundable",
    className: "bg-slate-100 text-slate-600",
  };
}

function generateIdempotencyKey(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function fetchSalesList(filters: {
  search: string;
  fromDate: string;
  toDate: string;
  dueOnly: boolean;
  refundFilter: RefundFilter;
  page: number;
  pageSize: number;
}) {
  const params = new URLSearchParams();

  if (filters.search.trim()) {
    params.set("q", filters.search.trim());
  }

  if (filters.fromDate) {
    params.set("from", filters.fromDate);
  }

  if (filters.toDate) {
    params.set("to", filters.toDate);
  }

  if (filters.dueOnly) {
    params.set("dueOnly", "1");
  }

  if (filters.refundFilter !== "all") {
    params.set("refundFilter", filters.refundFilter);
  }

  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));

  const query = params.toString();
  const res = await fetch(query ? `/api/sales?${query}` : "/api/sales", {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<SalesListResponse> | ApiErrorPayload;
  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load sales");
  }

  return payload.data;
}

async function fetchSaleDetails(saleId: number) {
  const res = await fetch(`/api/sales/${saleId}`, {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<SaleDetailResponse> | ApiErrorPayload;
  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load sale details");
  }

  return payload.data;
}

export default function SalesPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [refundFilter, setRefundFilter] = useState<RefundFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [dueAmount, setDueAmount] = useState("");
  const [dueNote, setDueNote] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const [refundQuantities, setRefundQuantities] = useState<Record<string, string>>({});

  const {
    data: salesData,
    isLoading: salesLoading,
    isError: salesError,
  } = useQuery({
    queryKey: ["sales-history", search, fromDate, toDate, dueOnly, refundFilter, page, pageSize],
    queryFn: () => fetchSalesList({
      search,
      fromDate,
      toDate,
      dueOnly,
      refundFilter,
      page,
      pageSize,
    }),
  });

  const sales = useMemo(() => salesData?.sales ?? [], [salesData]);
  const summary = useMemo(
    () =>
      salesData?.summary ?? {
        sale_count: 0,
        gross_total: "0.00",
        total_paid: "0.00",
        total_due: "0.00",
      },
    [salesData],
  );

  const pagination = useMemo(
    () => salesData?.pagination ?? {
      page,
      page_size: pageSize,
      total_count: sales.length,
      total_pages: 1,
    },
    [salesData, page, pageSize, sales.length],
  );

  const showingFrom =
    pagination.total_count === 0 ? 0 : (pagination.page - 1) * pagination.page_size + 1;
  const showingTo =
    pagination.total_count === 0
      ? 0
      : Math.min(pagination.page * pagination.page_size, pagination.total_count);

  const activeSaleId = useMemo(() => {
    if (sales.length === 0) {
      return null;
    }

    if (selectedSaleId && sales.some((sale) => sale.id === selectedSaleId)) {
      return selectedSaleId;
    }

    return sales[0].id;
  }, [sales, selectedSaleId]);

  const activeSale = useMemo(
    () => sales.find((sale) => sale.id === activeSaleId) ?? null,
    [activeSaleId, sales],
  );

  const {
    data: saleDetail,
    isLoading: saleDetailLoading,
    isError: saleDetailError,
  } = useQuery({
    queryKey: ["sale-detail", activeSaleId],
    queryFn: () => fetchSaleDetails(activeSaleId as number),
    enabled: Boolean(activeSaleId),
  });

  const selectedRefundItems = useMemo(() => {
    if (!saleDetail) {
      return [] as Array<{ sale_item_id: string; quantity: number }>;
    }

    const selected: Array<{ sale_item_id: string; quantity: number }> = [];

    for (const item of saleDetail.items) {
      const rawValue = refundQuantities[item.id] ?? "";
      const parsed = Number(rawValue);

      if (!Number.isFinite(parsed)) {
        continue;
      }

      const safeQuantity = Math.min(Math.max(Math.floor(parsed), 0), item.quantity);
      if (safeQuantity > 0) {
        selected.push({
          sale_item_id: item.id,
          quantity: safeQuantity,
        });
      }
    }

    return selected;
  }, [refundQuantities, saleDetail]);

  const collectDueMutation = useMutation({
    mutationFn: async () => {
      if (!activeSaleId) {
        throw new Error("Select a sale first");
      }

      const parsedAmount = Number(dueAmount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error("Enter a valid payment amount");
      }

      const res = await fetch(`/api/sales/${activeSaleId}/due-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": generateIdempotencyKey("sale-due"),
        },
        body: JSON.stringify({
          amount: parsedAmount,
          note: dueNote.trim() || null,
        }),
      });

      const payload = (await res.json()) as ApiSuccess<unknown> | ApiErrorPayload;
      if (!res.ok || !payload.success) {
        throw new Error((payload as ApiErrorPayload).message ?? "Failed to collect due payment");
      }
    },
    onSuccess: async () => {
      toast.success("Due payment collected");
      setDueAmount("");
      setDueNote("");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-history"] }),
        queryClient.invalidateQueries({ queryKey: ["sale-detail", activeSaleId] }),
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-history"] }),
      ]);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const refundMutation = useMutation({
    mutationFn: async () => {
      if (!activeSaleId) {
        throw new Error("Select a sale first");
      }

      if (selectedRefundItems.length === 0) {
        throw new Error("Select at least one product and quantity to refund");
      }

      const res = await fetch(`/api/sales/${activeSaleId}/refund`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": generateIdempotencyKey("sale-refund"),
        },
        body: JSON.stringify({
          items: selectedRefundItems,
          note: refundNote.trim() || null,
        }),
      });

      const payload = (await res.json()) as ApiSuccess<unknown> | ApiErrorPayload;
      if (!res.ok || !payload.success) {
        throw new Error((payload as ApiErrorPayload).message ?? "Failed to process refund");
      }
    },
    onSuccess: async () => {
      toast.success("Refund processed successfully");
      setRefundNote("");
      setRefundQuantities({});

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-history"] }),
        queryClient.invalidateQueries({ queryKey: ["sale-detail", activeSaleId] }),
        queryClient.invalidateQueries({ queryKey: ["stock-module"] }),
        queryClient.invalidateQueries({ queryKey: ["reports-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["reports-range"] }),
        queryClient.invalidateQueries({ queryKey: ["reports-products"] }),
      ]);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Sales History</h2>
        <p className="text-sm text-slate-500">Track invoices, inspect line items, and collect due by sale</p>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input
            label="Search"
            placeholder="Sale #, phone, or customer name"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className="xl:col-span-2"
          />

          <Input
            label="From Date"
            type="date"
            value={fromDate}
            onChange={(event) => {
              setFromDate(event.target.value);
              setPage(1);
            }}
          />

          <Input
            label="To Date"
            type="date"
            value={toDate}
            onChange={(event) => {
              setToDate(event.target.value);
              setPage(1);
            }}
          />

          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={dueOnly}
                onChange={(event) => {
                  setDueOnly(event.target.checked);
                  setPage(1);
                }}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              Show only due sales
            </label>

            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs font-medium text-slate-600">Refund</span>
              <Button
                size="sm"
                variant={refundFilter === "all" ? "primary" : "ghost"}
                onClick={() => {
                  setRefundFilter("all");
                  setPage(1);
                }}
              >
                All
              </Button>
              <Button
                size="sm"
                variant={refundFilter === "refundable" ? "primary" : "ghost"}
                onClick={() => {
                  setRefundFilter("refundable");
                  setPage(1);
                }}
              >
                Refundable
              </Button>
              <Button
                size="sm"
                variant={refundFilter === "refunded" ? "primary" : "ghost"}
                onClick={() => {
                  setRefundFilter("refunded");
                  setPage(1);
                }}
              >
                Refunded
              </Button>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearch("");
                setFromDate("");
                setToDate("");
                setDueOnly(false);
                setRefundFilter("all");
                setPage(1);
              }}
            >
              Clear Filters
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Filtered Sales" value={String(summary.sale_count)} accent="blue" />
        <StatCard title="Gross Total" value={formatTaka(summary.gross_total)} accent="green" />
        <StatCard title="Collected" value={formatTaka(summary.total_paid)} accent="blue" />
        <StatCard title="Pending Due" value={formatTaka(summary.total_due)} accent="orange" />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <section className="xl:col-span-7">
          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">Sales List</h3>
            </div>

            {salesLoading ? <p className="px-4 py-6 text-sm text-slate-500">Loading sales...</p> : null}
            {salesError ? (
              <p className="px-4 py-6 text-sm text-red-600">Unable to load sales. Check your permission.</p>
            ) : null}

            {!salesLoading && !salesError ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Sale</th>
                      <th className="px-3 py-2 text-left">Customer</th>
                      <th className="px-3 py-2 text-left">Items</th>
                      <th className="px-3 py-2 text-left">Refund</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-right">Paid</th>
                      <th className="px-3 py-2 text-right">Due</th>
                      <th className="px-3 py-2 text-left">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.length === 0 ? (
                      <tr>
                        <td className="px-3 py-8 text-center text-slate-500" colSpan={8}>
                          No sales matched the current filters
                        </td>
                      </tr>
                    ) : (
                      sales.map((sale) => {
                        const isActive = sale.id === activeSaleId;
                        const refundBadge = resolveRefundBadge(sale);

                        return (
                          <tr
                            key={sale.id}
                            className={isActive ? "border-t border-slate-100 bg-blue-50" : "border-t border-slate-100"}
                          >
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedSaleId(sale.id);
                                  setDueAmount("");
                                  setDueNote("");
                                  setRefundNote("");
                                  setRefundQuantities({});
                                }}
                                className="font-semibold text-blue-700 hover:underline"
                              >
                                #{sale.id}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-slate-700">
                              <p className="font-medium text-slate-900">{sale.customer_name || "Walk-in"}</p>
                              <p className="text-xs text-slate-500">{sale.customer_phone}</p>
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-600">
                              {sale.item_count} lines / {sale.total_quantity} qty
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-col gap-1">
                                <span
                                  className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ${refundBadge.className}`}
                                >
                                  {refundBadge.label}
                                </span>
                                {Number(sale.refund_count ?? 0) > 0 ? (
                                  <span className="text-[11px] text-slate-500">
                                    {sale.refund_count} events / {parseNumber(sale.refunded_quantity)} qty
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatTaka(sale.total)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatTaka(sale.paid)}</td>
                            <td
                              className={
                                parseNumber(sale.due) > 0
                                  ? "px-3 py-2 text-right tabular-nums text-amber-700"
                                  : "px-3 py-2 text-right tabular-nums text-slate-700"
                              }
                            >
                              {formatTaka(sale.due)}
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(sale.created_at)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}

            {!salesLoading && !salesError ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
                <p className="text-xs text-slate-600">
                  Showing {showingFrom}-{showingTo} of {pagination.total_count}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <span>Rows</span>
                    <select
                      className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                      value={String(pagination.page_size)}
                      onChange={(event) => {
                        setPageSize(Number(event.target.value));
                        setPage(1);
                      }}
                    >
                      <option value="10">10</option>
                      <option value="25">25</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                    </select>
                  </label>

                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                    disabled={pagination.page <= 1}
                  >
                    Previous
                  </Button>

                  <span className="min-w-24 text-center text-xs text-slate-600">
                    Page {pagination.page} of {pagination.total_pages}
                  </span>

                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setPage((prev) => Math.min(prev + 1, pagination.total_pages))
                    }
                    disabled={pagination.page >= pagination.total_pages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </section>

        <section className="space-y-4 xl:col-span-5">
          {!activeSaleId ? (
            <Card className="p-5 text-sm text-slate-600">Select a sale to inspect items and due payment timeline.</Card>
          ) : null}

          {activeSaleId && saleDetailLoading ? (
            <Card className="p-5 text-sm text-slate-500">Loading sale details...</Card>
          ) : null}

          {activeSaleId && saleDetailError ? (
            <Card className="p-5 text-sm text-red-600">Failed to load selected sale.</Card>
          ) : null}

          {saleDetail ? (
            <>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">Sale #{saleDetail.sale.id}</h3>
                    <p className="text-xs text-slate-500">Created {formatDateTime(saleDetail.sale.created_at)}</p>
                    <p className="text-xs text-slate-500">By {saleDetail.sale.created_by_name || "System"}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    Customer: <span className="font-semibold">{saleDetail.sale.customer_type || "Regular"}</span>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Total</p>
                    <p className="mt-1 text-base font-semibold text-slate-900 tabular-nums">
                      {formatTaka(saleDetail.sale.total)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Tendered</p>
                    <p className="mt-1 text-base font-semibold text-blue-700 tabular-nums">
                      {formatTaka(saleDetail.sale.tendered)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Paid</p>
                    <p className="mt-1 text-base font-semibold text-emerald-700 tabular-nums">
                      {formatTaka(saleDetail.sale.paid)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Current Due</p>
                    <p className="mt-1 text-base font-semibold text-amber-700 tabular-nums">
                      {formatTaka(saleDetail.sale.due)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Customer Due</p>
                    <p className="mt-1 text-base font-semibold text-slate-900 tabular-nums">
                      {formatTaka(saleDetail.sale.customer_due || "0.00")}
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <p>
                    <span className="font-medium">Customer:</span>{" "}
                    {saleDetail.sale.customer_name || "Walk-in"} ({saleDetail.sale.customer_phone})
                  </p>
                  {saleDetail.sale.customer_address ? (
                    <p className="mt-1 text-slate-500">Address: {saleDetail.sale.customer_address}</p>
                  ) : null}
                  {saleDetail.sale.note ? (
                    <p className="mt-1 text-slate-500">Note: {saleDetail.sale.note}</p>
                  ) : null}
                </div>
              </Card>

              {parseNumber(saleDetail.sale.due) > 0 ? (
                <Card className="p-4">
                  <h4 className="text-sm font-semibold text-slate-900">Collect Due For This Sale</h4>
                  <p className="mt-1 text-xs text-slate-500">
                    Remaining due: <span className="font-semibold text-amber-700">{formatTaka(saleDetail.sale.due)}</span>
                  </p>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Input
                      label="Amount"
                      type="number"
                      min={0}
                      step="0.01"
                      value={dueAmount}
                      onChange={(event) => setDueAmount(event.target.value)}
                      placeholder="0.00"
                    />
                    <Input
                      label="Note"
                      value={dueNote}
                      onChange={(event) => setDueNote(event.target.value)}
                      placeholder="Optional note"
                    />
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button onClick={() => collectDueMutation.mutate()} disabled={collectDueMutation.isPending}>
                      {collectDueMutation.isPending ? "Collecting..." : "Collect Due"}
                    </Button>
                  </div>
                </Card>
              ) : (
                <Card className="p-4 text-sm text-emerald-700">This sale is fully paid.</Card>
              )}

              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">Refund Products From This Sale</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Select product quantities to refund. Stock will be restored automatically.
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    Refunded so far: <span className="font-semibold">{saleDetail.refund_summary.units_refunded} qty</span>
                  </div>
                </div>

                {saleDetail.items.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">
                    No refundable line items left for this sale.
                  </p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left">Product</th>
                          <th className="px-3 py-2 text-right">Refundable Qty</th>
                          <th className="px-3 py-2 text-right">Refund Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {saleDetail.items.map((item) => (
                          <tr key={`refund-${item.id}`} className="border-t border-slate-100">
                            <td className="px-3 py-2 text-slate-700">{item.product_name}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{item.quantity}</td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                min={0}
                                max={item.quantity}
                                step={1}
                                value={refundQuantities[item.id] ?? ""}
                                onChange={(event) => {
                                  const raw = event.target.value;
                                  if (!raw) {
                                    setRefundQuantities((prev) => {
                                      const next = { ...prev };
                                      delete next[item.id];
                                      return next;
                                    });
                                    return;
                                  }

                                  const parsed = Number(raw);
                                  const safe = Number.isFinite(parsed)
                                    ? Math.min(Math.max(Math.floor(parsed), 0), item.quantity)
                                    : 0;

                                  setRefundQuantities((prev) => ({
                                    ...prev,
                                    [item.id]: String(safe),
                                  }));
                                }}
                                className="h-9 w-24 rounded-md border border-slate-300 px-2 text-right text-sm"
                                placeholder="0"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Refund Note"
                    value={refundNote}
                    onChange={(event) => setRefundNote(event.target.value)}
                    placeholder="Reason for refund"
                  />
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <p>
                      Selected lines: <span className="font-semibold">{selectedRefundItems.length}</span>
                    </p>
                    <p className="mt-1">
                      Selected qty: <span className="font-semibold tabular-nums">
                        {selectedRefundItems.reduce((sum, item) => sum + item.quantity, 0)}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <Button
                    onClick={() => refundMutation.mutate()}
                    disabled={refundMutation.isPending || selectedRefundItems.length === 0}
                  >
                    {refundMutation.isPending ? "Processing Refund..." : "Process Refund"}
                  </Button>
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="border-b border-slate-200 px-4 py-3">
                  <h4 className="text-sm font-semibold text-slate-900">Item Breakdown</h4>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Product</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Unit Price</th>
                        <th className="px-3 py-2 text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {saleDetail.items.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
                            No line items found
                          </td>
                        </tr>
                      ) : (
                        saleDetail.items.map((item) => (
                          <tr key={item.id} className="border-t border-slate-100">
                            <td className="px-3 py-2 text-slate-700">{item.product_name}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{item.quantity}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatTaka(item.sell_price)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">
                              {formatTaka(item.total)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h4 className="text-sm font-semibold text-slate-900">Due Payment Timeline</h4>
                  <p className="text-xs text-slate-500">
                    Collected: <span className="font-semibold text-emerald-700">{formatTaka(saleDetail.payment_summary.total_due_paid)}</span>
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-left">Collected By</th>
                        <th className="px-3 py-2 text-left">Note</th>
                        <th className="px-3 py-2 text-left">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {saleDetail.due_payments.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
                            No due payments for this sale yet
                          </td>
                        </tr>
                      ) : (
                        saleDetail.due_payments.map((payment) => (
                          <tr key={payment.id} className="border-t border-slate-100">
                            <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                              {formatTaka(payment.amount)}
                            </td>
                            <td className="px-3 py-2 text-slate-700">{payment.created_by_name || "System"}</td>
                            <td className="px-3 py-2 text-xs text-slate-600">{payment.note || "-"}</td>
                            <td className="px-3 py-2 text-xs text-slate-500">
                              {formatDateTime(payment.created_at)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h4 className="text-sm font-semibold text-slate-900">Refund Timeline</h4>
                  <p className="text-xs text-slate-500">
                    Refunds: <span className="font-semibold">{saleDetail.refund_summary.refund_count}</span>
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Refund ID</th>
                        <th className="px-3 py-2 text-left">Items</th>
                        <th className="px-3 py-2 text-left">Processed By</th>
                        <th className="px-3 py-2 text-left">Note</th>
                        <th className="px-3 py-2 text-left">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {saleDetail.refunds.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                            No refunds for this sale yet
                          </td>
                        </tr>
                      ) : (
                        saleDetail.refunds.map((refund) => (
                          <tr key={refund.id} className="border-t border-slate-100">
                            <td className="px-3 py-2 text-xs font-medium text-slate-700">{refund.id.slice(0, 8)}</td>
                            <td className="px-3 py-2 text-xs text-slate-600">
                              {refund.items.map((item) => `${item.product_name} (${item.quantity})`).join(", ") || "-"}
                            </td>
                            <td className="px-3 py-2 text-slate-700">{refund.created_by_name || "System"}</td>
                            <td className="px-3 py-2 text-xs text-slate-600">{refund.refund_note || "-"}</td>
                            <td className="px-3 py-2 text-xs text-slate-500">
                              {formatDateTime(refund.created_at)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          ) : null}

          {activeSale && !saleDetail ? (
            <Card className="p-4 text-sm text-slate-600">Loading detail for sale #{activeSale.id}...</Card>
          ) : null}
        </section>
      </div>
    </div>
  );
}
