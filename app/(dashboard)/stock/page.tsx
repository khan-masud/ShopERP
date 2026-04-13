"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { StatCard } from "@/components/ui/StatCard";
import { formatDateTime, formatTaka } from "@/lib/utils";

type StockProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  stock: number;
  min_stock: number;
  buy_price: string;
  sell_price: string;
};

type StockHistoryItem = {
  id: string;
  product_id: string;
  product_name: string;
  change_type: "restock" | "sale" | "adjustment";
  quantity_change: number;
  quantity_before: number;
  quantity_after: number;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
};

type StockResponse = {
  products: StockProduct[];
  products_pagination: {
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
  };
  history: StockHistoryItem[];
  history_pagination: {
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
  };
  summary: {
    total_products: number;
    low_stock_count: number;
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

async function fetchStock(
  search: string,
  lowOnly: boolean,
  productPage: number,
  productPageSize: number,
  historyPage: number,
  historyPageSize: number,
) {
  const params = new URLSearchParams();

  if (search.trim()) {
    params.set("q", search.trim());
  }

  if (lowOnly) {
    params.set("lowOnly", "1");
  }

  params.set("page", String(productPage));
  params.set("pageSize", String(productPageSize));

  params.set("historyPage", String(historyPage));
  params.set("historyPageSize", String(historyPageSize));

  const query = params.toString();
  const res = await fetch(query ? `/api/stock?${query}` : "/api/stock", {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<StockResponse> | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load stock data");
  }

  return payload.data;
}

export default function StockPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [productPage, setProductPage] = useState(1);
  const [productPageSize, setProductPageSize] = useState(50);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [changeType, setChangeType] = useState<"restock" | "adjustment">("restock");
  const [quantityChange, setQuantityChange] = useState("");
  const [note, setNote] = useState("");

  const {
    data,
    isLoading,
    isError,
  } = useQuery({
    queryKey: [
      "stock-module",
      search,
      lowOnly,
      productPage,
      productPageSize,
      historyPage,
      historyPageSize,
    ],
    queryFn: () =>
      fetchStock(search, lowOnly, productPage, productPageSize, historyPage, historyPageSize),
  });

  const products = useMemo(() => data?.products ?? [], [data]);
  const productsPagination = data?.products_pagination ?? {
    page: productPage,
    page_size: productPageSize,
    total_count: products.length,
    total_pages: 1,
  };
  const productsTotalCount = productsPagination.total_count;
  const showingProductsFrom =
    productsTotalCount === 0 ? 0 : (productsPagination.page - 1) * productsPagination.page_size + 1;
  const showingProductsTo =
    productsTotalCount === 0
      ? 0
      : Math.min(productsPagination.page * productsPagination.page_size, productsTotalCount);

  const history = data?.history ?? [];
  const historyPagination = data?.history_pagination ?? {
    page: historyPage,
    page_size: historyPageSize,
    total_count: history.length,
    total_pages: 1,
  };
  const historyTotalCount = historyPagination.total_count;
  const showingHistoryFrom =
    historyTotalCount === 0 ? 0 : (historyPagination.page - 1) * historyPagination.page_size + 1;
  const showingHistoryTo =
    historyTotalCount === 0
      ? 0
      : Math.min(historyPagination.page * historyPagination.page_size, historyTotalCount);
  const summary = data?.summary ?? { total_products: 0, low_stock_count: 0 };

  const activeProductId = useMemo(() => {
    if (selectedProductId && products.some((item) => item.id === selectedProductId)) {
      return selectedProductId;
    }

    return products[0]?.id ?? "";
  }, [products, selectedProductId]);

  const activeProduct = useMemo(
    () => products.find((item) => item.id === activeProductId) ?? null,
    [products, activeProductId],
  );

  const adjustMutation = useMutation({
    mutationFn: async () => {
      if (!activeProductId) {
        throw new Error("Select a product for stock adjustment");
      }

      const parsedQuantity = Number(quantityChange);

      if (!Number.isInteger(parsedQuantity) || parsedQuantity === 0) {
        throw new Error("Quantity change must be a non-zero integer");
      }

      if (changeType === "restock" && parsedQuantity < 0) {
        throw new Error("Restock quantity must be positive");
      }

      const res = await fetch("/api/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product_id: activeProductId,
          change_type: changeType,
          quantity_change: parsedQuantity,
          note: note.trim() || null,
        }),
      });

      const payload = (await res.json()) as ApiSuccess<unknown> | ApiErrorPayload;

      if (!res.ok || !payload.success) {
        throw new Error((payload as ApiErrorPayload).message ?? "Failed to apply stock adjustment");
      }
    },
    onSuccess: async () => {
      toast.success("Stock updated");
      setQuantityChange("");
      setNote("");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["stock-module"] }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
      ]);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Stock Adjustment</h2>
        <p className="text-sm text-slate-500">Manage manual stock corrections and maintain an auditable inventory timeline</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard title="Active Products" value={String(summary.total_products)} accent="blue" />
        <StatCard title="Low Stock Items" value={String(summary.low_stock_count)} accent="orange" />
        <StatCard
          title="Selected Product"
          value={activeProduct ? `${activeProduct.name} (${activeProduct.stock})` : "N/A"}
          accent="green"
        />
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Input
            label="Search Product"
            placeholder="Name or SKU"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setProductPage(1);
              setHistoryPage(1);
            }}
          />

          <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(event) => {
                setLowOnly(event.target.checked);
                setProductPage(1);
                setHistoryPage(1);
              }}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            Show only low stock
          </label>

          <div className="flex items-end justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setLowOnly(false);
                setProductPage(1);
                setHistoryPage(1);
              }}
            >
              Clear Filters
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-900">Apply Stock Change</h3>

        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="flex flex-col gap-1.5 xl:col-span-2">
            <span className="text-xs font-medium text-slate-600">Product</span>
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              value={activeProductId}
              onChange={(event) => setSelectedProductId(event.target.value)}
            >
              {products.length === 0 ? <option value="">No products available</option> : null}
              {products.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.sku}) | Stock {item.stock}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Change Type</span>
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              value={changeType}
              onChange={(event) => setChangeType(event.target.value as "restock" | "adjustment")}
            >
              <option value="restock">Restock (+)</option>
              <option value="adjustment">Adjustment (+/-)</option>
            </select>
          </label>

          <Input
            label="Quantity Change"
            type="number"
            step="1"
            value={quantityChange}
            onChange={(event) => setQuantityChange(event.target.value)}
            placeholder={changeType === "restock" ? "e.g. 10" : "e.g. -2 or 5"}
          />

          <Input
            label="Note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional adjustment note"
            className="xl:col-span-3"
          />

          <div className="flex items-end justify-end xl:col-span-2">
            <Button onClick={() => adjustMutation.mutate()} disabled={adjustMutation.isPending || !activeProductId}>
              {adjustMutation.isPending ? "Applying..." : "Apply Change"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Current Stock</h3>
        </div>

        {isLoading ? <p className="px-4 py-6 text-sm text-slate-500">Loading stock...</p> : null}
        {isError ? <p className="px-4 py-6 text-sm text-red-600">Failed to load stock data.</p> : null}

        {!isLoading && !isError ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-right">Buy</th>
                  <th className="px-3 py-2 text-right">Sell</th>
                  <th className="px-3 py-2 text-right">Stock</th>
                  <th className="px-3 py-2 text-right">Min Stock</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-slate-500" colSpan={7}>
                      No products found
                    </td>
                  </tr>
                ) : (
                  products.map((item) => (
                    <tr
                      key={item.id}
                      className={
                        item.stock <= item.min_stock
                          ? "border-t border-slate-100 bg-orange-50/60"
                          : "border-t border-slate-100"
                      }
                    >
                      <td className="px-3 py-2 font-medium text-slate-900">{item.name}</td>
                      <td className="px-3 py-2 text-slate-600">{item.sku}</td>
                      <td className="px-3 py-2 text-slate-700">{item.category}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatTaka(item.buy_price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatTaka(item.sell_price)}</td>
                      <td
                        className={
                          item.stock <= item.min_stock
                            ? "px-3 py-2 text-right tabular-nums font-semibold text-orange-700"
                            : "px-3 py-2 text-right tabular-nums text-slate-900"
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
        ) : null}

        {!isLoading && !isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-600">
              Showing {showingProductsFrom}-{showingProductsTo} of {productsTotalCount}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <span>Rows</span>
                <select
                  className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                  value={String(productsPagination.page_size)}
                  onChange={(event) => {
                    setProductPageSize(Number(event.target.value));
                    setProductPage(1);
                  }}
                >
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                </select>
              </label>

              <Button
                size="sm"
                variant="secondary"
                onClick={() => setProductPage((prev) => Math.max(prev - 1, 1))}
                disabled={productsPagination.page <= 1}
              >
                Previous
              </Button>

              <span className="min-w-24 text-center text-xs text-slate-600">
                Page {productsPagination.page} of {productsPagination.total_pages}
              </span>

              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setProductPage((prev) => Math.min(prev + 1, productsPagination.total_pages))
                }
                disabled={productsPagination.page >= productsPagination.total_pages}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Stock History</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-right">Change</th>
                <th className="px-3 py-2 text-right">Before</th>
                <th className="px-3 py-2 text-right">After</th>
                <th className="px-3 py-2 text-left">By</th>
                <th className="px-3 py-2 text-left">Note</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-slate-500" colSpan={8}>
                    No stock history found
                  </td>
                </tr>
              ) : (
                history.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(item.created_at)}</td>
                    <td className="px-3 py-2 text-slate-900">{item.product_name}</td>
                    <td className="px-3 py-2 text-slate-700">{item.change_type}</td>
                    <td
                      className={
                        item.quantity_change >= 0
                          ? "px-3 py-2 text-right tabular-nums text-emerald-700"
                          : "px-3 py-2 text-right tabular-nums text-red-700"
                      }
                    >
                      {item.quantity_change >= 0 ? `+${item.quantity_change}` : item.quantity_change}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{item.quantity_before}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900">{item.quantity_after}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{item.created_by_name || "System"}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{item.note || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-600">
            Showing {showingHistoryFrom}-{showingHistoryTo} of {historyTotalCount}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <span>Rows</span>
              <select
                className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                value={String(historyPagination.page_size)}
                onChange={(event) => {
                  setHistoryPageSize(Number(event.target.value));
                  setHistoryPage(1);
                }}
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </label>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => setHistoryPage((prev) => Math.max(prev - 1, 1))}
              disabled={historyPagination.page <= 1}
            >
              Previous
            </Button>

            <span className="min-w-24 text-center text-xs text-slate-600">
              Page {historyPagination.page} of {historyPagination.total_pages}
            </span>

            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setHistoryPage((prev) => Math.min(prev + 1, historyPagination.total_pages))
              }
              disabled={historyPagination.page >= historyPagination.total_pages}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
