"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Minus, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { formatDateTime, formatTaka, getRuntimeSiteSettings } from "@/lib/utils";

type Product = {
  id: string;
  name: string;
  category: string;
  sku: string;
  sell_price: string;
  stock: number;
  min_stock: number;
};

type CartItem = {
  product: Product;
  quantity: number;
  addedAt: number;
};

type ProductsApiResponse = {
  products: Product[];
  pagination: {
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
  };
};

type CheckoutLineItem = {
  product_id: string;
  product_name: string;
  quantity: number;
  sell_price: number;
  total: number;
};

type CheckoutSuccessResponse = {
  sale_id: number;
  customer_phone: string;
  subtotal: number;
  discount_percent: number;
  discount_amount: number;
  total: number;
  tendered: number;
  paid: number;
  due: number;
  change: number;
  loyalty_earned: number;
  items: CheckoutLineItem[];
};

type CheckoutModalSummary = CheckoutSuccessResponse & {
  customer_name: string | null;
  customer_address: string | null;
  completed_at: string;
};

function generateIdempotencyKey(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseNonNegativeNumberInput(value: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSlipHtml(summary: CheckoutModalSummary) {
  const siteSettings = getRuntimeSiteSettings();
  const itemRows = summary.items
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item.product_name)}</td>
          <td style="text-align:right;">${item.quantity}</td>
          <td style="text-align:right;">${escapeHtml(formatTaka(item.sell_price))}</td>
          <td style="text-align:right;">${escapeHtml(formatTaka(item.total))}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(siteSettings.site_name)} Sale #${summary.sale_id}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 16px; color: #0f172a; }
      h1 { margin: 0 0 4px; font-size: 18px; }
      p { margin: 2px 0; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border-bottom: 1px solid #e2e8f0; padding: 6px 4px; font-size: 12px; }
      th { text-align: left; color: #475569; }
      .totals { margin-top: 12px; }
      .row { display: flex; justify-content: space-between; font-size: 12px; margin: 2px 0; }
      .bold { font-weight: 700; }
      .thanks { margin-top: 14px; text-align: center; font-size: 12px; color: #475569; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(siteSettings.site_name)}</h1>
    ${siteSettings.phone_number ? `<p><strong>Shop Phone:</strong> ${escapeHtml(siteSettings.phone_number)}</p>` : ""}
    ${siteSettings.address ? `<p><strong>Shop Address:</strong> ${escapeHtml(siteSettings.address)}</p>` : ""}
    <p><strong>Sale:</strong> #${summary.sale_id}</p>
    <p><strong>Date:</strong> ${escapeHtml(formatDateTime(summary.completed_at))}</p>
    <p><strong>Phone:</strong> ${escapeHtml(summary.customer_phone)}</p>
    <p><strong>Name:</strong> ${escapeHtml(summary.customer_name || "Walk-in")}</p>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Item</th>
          <th style="text-align:right;">Qty</th>
          <th style="text-align:right;">Rate</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows || '<tr><td colspan="5">No items</td></tr>'}
      </tbody>
    </table>

    <div class="totals">
      <div class="row"><span>Subtotal</span><span>${escapeHtml(formatTaka(summary.subtotal))}</span></div>
      <div class="row"><span>Discount</span><span>${escapeHtml(formatTaka(summary.discount_amount))}</span></div>
      <div class="row bold"><span>Total</span><span>${escapeHtml(formatTaka(summary.total))}</span></div>
      <div class="row"><span>Paid</span><span>${escapeHtml(formatTaka(summary.paid))}</span></div>
      <div class="row"><span>Due</span><span>${escapeHtml(formatTaka(summary.due))}</span></div>
      <div class="row"><span>Change</span><span>${escapeHtml(formatTaka(summary.change))}</span></div>
    </div>

    <p class="thanks">Thank you for your purchase.</p>
  </body>
</html>`;
}

async function fetchProducts(search: string, page: number, pageSize: number) {
  const params = new URLSearchParams();
  const searchQuery = search.trim();

  if (searchQuery) {
    params.set("q", searchQuery);
  }

  params.set("sort", "top_selling");

  // Keep default top-selling feed focused on available stock.
  // When searching, include stock-out products so staff can still find them.
  if (!searchQuery) {
    params.set("inStockOnly", "1");
  }

  params.set("page", String(page));
  params.set("pageSize", String(pageSize));

  const res = await fetch(`/api/products?${params.toString()}`, {
    cache: "no-store",
  });

  const payload = (await res.json()) as {
    success: boolean;
    data?: ProductsApiResponse;
    message?: string;
  };

  if (!res.ok || !payload.success) {
    throw new Error(payload.message ?? "Failed to load products");
  }

  const safeData = payload.data ?? {
    products: [],
    pagination: {
      page,
      page_size: pageSize,
      total_count: 0,
      total_pages: 1,
    },
  };

  return safeData;
}

export default function POSPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [productPage, setProductPage] = useState(1);
  const [productPageSize, setProductPageSize] = useState(12);
  const [cart, setCart] = useState<Record<string, CartItem>>({});

  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [discountAmountInput, setDiscountAmountInput] = useState("");
  const [paidAmountInput, setPaidAmountInput] = useState("");
  const [showZeroPaidConfirm, setShowZeroPaidConfirm] = useState(false);
  const [checkoutSummary, setCheckoutSummary] = useState<CheckoutModalSummary | null>(null);

  const { data: productsData, isLoading } = useQuery({
    queryKey: ["pos-products", search, productPage, productPageSize],
    queryFn: () => fetchProducts(search, productPage, productPageSize),
  });

  const products = productsData?.products ?? [];
  const productsPagination = productsData?.pagination ?? {
    page: productPage,
    page_size: productPageSize,
    total_count: products.length,
    total_pages: 1,
  };

  const cartItems = useMemo(
    () => Object.values(cart).sort((left, right) => right.addedAt - left.addedAt),
    [cart],
  );

  const subtotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + Number(item.product.sell_price) * item.quantity, 0),
    [cartItems],
  );

  const discountAmount = Math.min(parseNonNegativeNumberInput(discountAmountInput), subtotal);
  const paidAmount = parseNonNegativeNumberInput(paidAmountInput);
  const total = Math.max(subtotal - discountAmount, 0);
  const due = Math.max(total - paidAmount, 0);
  const change = Math.max(paidAmount - total, 0);

  useEffect(() => {
    if (!checkoutSummary) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCheckoutSummary(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [checkoutSummary]);

  function addToCart(product: Product) {
    if (product.stock <= 0) {
      return;
    }

    setCart((prev) => {
      const existing = prev[product.id];
      const currentQty = existing?.quantity ?? 0;
      const nextQty = Math.min(currentQty + 1, product.stock);
      const addedAt = Date.now();

      return {
        ...prev,
        [product.id]: {
          product,
          quantity: nextQty,
          addedAt,
        },
      };
    });
  }

  function updateQty(productId: string, qty: number) {
    setCart((prev) => {
      const existing = prev[productId];
      if (!existing) return prev;

      if (qty <= 0) {
        const clone = { ...prev };
        delete clone[productId];
        return clone;
      }

      return {
        ...prev,
        [productId]: {
          ...existing,
          quantity: Math.min(qty, existing.product.stock),
        },
      };
    });
  }

  function updateQtyFromInput(productId: string, rawQty: string) {
    if (rawQty.trim() === "") {
      return;
    }

    const parsed = Number(rawQty);
    if (!Number.isFinite(parsed)) {
      return;
    }

    updateQty(productId, Math.floor(parsed));
  }

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      if (!customerPhone.trim()) {
        throw new Error("Customer phone is required");
      }

      if (cartItems.length === 0) {
        throw new Error("Cart is empty");
      }

      const res = await fetch("/api/sales/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": generateIdempotencyKey("checkout"),
        },
        body: JSON.stringify({
          customer_phone: customerPhone.trim(),
          customer_name: customerName.trim() || null,
          customer_address: customerAddress.trim() || null,
          discount_amount: discountAmount,
          paid: paidAmount,
          items: cartItems.map((item) => ({
            product_id: item.product.id,
            quantity: item.quantity,
          })),
        }),
      });

      const payload = (await res.json()) as {
        success: boolean;
        message?: string;
        data?: CheckoutSuccessResponse;
      };

      if (!res.ok || !payload.success) {
        throw new Error(payload.message ?? "Checkout failed");
      }

      return payload.data;
    },
    onSuccess: (data) => {
      toast.success(`Sale #${data?.sale_id ?? ""} completed`);
      setShowZeroPaidConfirm(false);

      const customerNameSnapshot = customerName.trim() || null;
      const customerAddressSnapshot = customerAddress.trim() || null;

      if (data) {
        setCheckoutSummary({
          ...data,
          customer_name: customerNameSnapshot,
          customer_address: customerAddressSnapshot,
          completed_at: new Date().toISOString(),
        });
      }

      setCart({});
      setCustomerName("");
      setCustomerAddress("");
      setDiscountAmountInput("");
      setPaidAmountInput("");
      queryClient.invalidateQueries({ queryKey: ["pos-products"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function handlePrintSlip() {
    if (!checkoutSummary) {
      return;
    }

    const printFrame = document.createElement("iframe");
    printFrame.style.position = "fixed";
    printFrame.style.right = "0";
    printFrame.style.bottom = "0";
    printFrame.style.width = "0";
    printFrame.style.height = "0";
    printFrame.style.border = "0";
    printFrame.setAttribute("aria-hidden", "true");

    document.body.appendChild(printFrame);

    const frameWindow = printFrame.contentWindow;
    const frameDocument = frameWindow?.document;

    if (!frameWindow || !frameDocument) {
      if (printFrame.parentNode) {
        printFrame.parentNode.removeChild(printFrame);
      }
      toast.error("Unable to start print preview.");
      return;
    }

    frameDocument.open();
    frameDocument.write(buildSlipHtml(checkoutSummary));
    frameDocument.close();

    const cleanup = () => {
      if (printFrame.parentNode) {
        printFrame.parentNode.removeChild(printFrame);
      }
    };

    frameWindow.onafterprint = cleanup;
    frameWindow.focus();

    window.setTimeout(() => {
      frameWindow.print();
    }, 100);

    window.setTimeout(cleanup, 60_000);
  }

  function handleCheckoutClick() {
    if (checkoutMutation.isPending || cartItems.length === 0) {
      return;
    }

    if (paidAmount <= 0 && total > 0) {
      setShowZeroPaidConfirm(true);
      return;
    }

    checkoutMutation.mutate();
  }

  function handleConfirmZeroPaidCheckout() {
    if (checkoutMutation.isPending) {
      return;
    }

    setShowZeroPaidConfirm(false);
    checkoutMutation.mutate();
  }

  function handleStartNewSale() {
    setCheckoutSummary(null);
    setShowZeroPaidConfirm(false);
    setCustomerPhone("");
    setCustomerName("");
    setCustomerAddress("");
    setDiscountAmountInput("");
    setPaidAmountInput("");
  }

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-12">
        <section className="xl:col-span-7">
          <Card className="p-4">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">New Sale / POS</h2>
                <p className="text-sm text-slate-500">Select products and add them to the cart</p>
              </div>
            </div>

          <Input
            placeholder="Search product by name or SKU"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setProductPage(1);
            }}
            className="mb-4"
          />

          {isLoading ? <p className="text-sm text-slate-500">Loading products...</p> : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => {
              const isOutOfStock = product.stock <= 0;

              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addToCart(product)}
                  disabled={isOutOfStock}
                  className={`rounded-xl border p-3 text-left transition ${
                    isOutOfStock
                      ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-70"
                      : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50"
                  }`}
                >
                  <p className="line-clamp-1 text-sm font-semibold text-slate-900">{product.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{product.category}</p>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className={isOutOfStock ? "font-semibold text-slate-500" : "font-semibold text-blue-700"}>
                      {formatTaka(product.sell_price)}
                    </span>
                    {isOutOfStock ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                        Stock out
                      </span>
                    ) : (
                      <span className="tabular-nums text-slate-600">Stock {product.stock}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
            <p className="text-xs text-slate-600">
              Showing {products.length} of {productsPagination.total_count} products
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
                  <option value="12">12</option>
                  <option value="24">24</option>
                  <option value="36">36</option>
                  <option value="48">48</option>
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
          </Card>
        </section>

        <section className="xl:col-span-5">
          <Card className="p-4">
            <h3 className="text-lg font-semibold text-slate-900">Cart & Customer</h3>

          <div className="mt-4 space-y-3">
            <Input
              label="Customer Phone (Required)"
              value={customerPhone}
              onChange={(event) => setCustomerPhone(event.target.value)}
              placeholder="01XXXXXXXXX"
              required
            />
            <Input
              label="Customer Name"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder="Optional"
            />
            <Input
              label="Customer Address"
              value={customerAddress}
              onChange={(event) => setCustomerAddress(event.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
            {cartItems.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
                Cart is empty
              </p>
            ) : (
              cartItems.map((item) => (
                <div key={item.product.id} className="rounded-lg border border-slate-200 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{item.product.name}</p>
                      <p className="text-xs text-slate-500">{formatTaka(item.product.sell_price)}</p>
                    </div>
                    <button
                      type="button"
                      className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                      onClick={() => updateQty(item.product.id, 0)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    <div className="inline-flex items-center rounded-lg border border-slate-200">
                      <button
                        type="button"
                        className="px-2 py-1 text-slate-600"
                        onClick={() => updateQty(item.product.id, item.quantity - 1)}
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={item.product.stock}
                        inputMode="numeric"
                        value={item.quantity}
                        onChange={(event) => updateQtyFromInput(item.product.id, event.target.value)}
                        className="h-7 w-14 border-x border-slate-200 bg-white px-1 text-center text-sm tabular-nums text-slate-900 focus:outline-none"
                      />
                      <button
                        type="button"
                        className="px-2 py-1 text-slate-600"
                        onClick={() => updateQty(item.product.id, item.quantity + 1)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <p className="text-sm font-semibold text-slate-900 tabular-nums">
                      {formatTaka(Number(item.product.sell_price) * item.quantity)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 space-y-2 border-t border-slate-200 pt-4 text-sm">
            <Input
              label="Discount Amount (৳)"
              type="number"
              min={0}
              step="0.01"
              value={discountAmountInput}
              onChange={(event) => setDiscountAmountInput(event.target.value)}
            />
            <label className="relative flex w-full flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">Paid Amount</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={paidAmountInput}
                onChange={(event) => setPaidAmountInput(event.target.value)}
                className="h-10 rounded-lg border border-slate-300 px-3 pr-28 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={() => setPaidAmountInput(total.toFixed(2))}
                disabled={cartItems.length === 0}
                className="absolute bottom-1.5 right-10 rounded-md bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Full Paid
              </button>
            </label>

            <div className="space-y-1 rounded-lg bg-slate-50 p-3 tabular-nums">
              <div className="flex items-center justify-between">
                <span>Subtotal</span>
                <span>{formatTaka(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Discount</span>
                <span>{formatTaka(discountAmount)}</span>
              </div>
              <div className="flex items-center justify-between font-semibold text-slate-900">
                <span>Total</span>
                <span>{formatTaka(total)}</span>
              </div>
              <div className="flex items-center justify-between text-amber-700">
                <span>Due</span>
                <span>{formatTaka(due)}</span>
              </div>
              <div className="flex items-center justify-between text-emerald-700">
                <span>Change</span>
                <span>{formatTaka(change)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                onClick={() => setCart({})}
                disabled={cartItems.length === 0 || checkoutMutation.isPending}
              >
                Clear Cart
              </Button>
              <Button
                onClick={handleCheckoutClick}
                disabled={checkoutMutation.isPending || cartItems.length === 0}
              >
                {checkoutMutation.isPending ? "Processing..." : "Checkout"}
              </Button>
            </div>
          </div>
          </Card>
        </section>
      </div>

      {showZeroPaidConfirm && !checkoutSummary ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">Confirm Checkout</h3>
            <p className="mt-2 text-sm text-slate-600">
              Paid amount is zero. This sale will be saved as full due. Do you want to continue?
            </p>

            <div className="mt-4 flex justify-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setShowZeroPaidConfirm(false)}
                disabled={checkoutMutation.isPending}
              >
                Cancel
              </Button>
              <Button onClick={handleConfirmZeroPaidCheckout} disabled={checkoutMutation.isPending}>
                Continue Checkout
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {checkoutSummary ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="relative inline-flex h-20 w-20 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-200/80" />
                <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
                  <Check size={34} strokeWidth={3} />
                </span>
              </div>

              <h3 className="mt-3 text-xl font-semibold text-slate-900">Checkout Completed</h3>
              <p className="text-sm text-slate-500">Sale #{checkoutSummary.sale_id} has been created successfully.</p>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 p-4">
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <p><span className="text-slate-500">Date:</span> <span className="font-medium">{formatDateTime(checkoutSummary.completed_at)}</span></p>
                <p><span className="text-slate-500">Phone:</span> <span className="font-medium">{checkoutSummary.customer_phone}</span></p>
                <p><span className="text-slate-500">Customer:</span> <span className="font-medium">{checkoutSummary.customer_name || "Walk-in"}</span></p>
                <p><span className="text-slate-500">Items:</span> <span className="font-medium">{checkoutSummary.items.length}</span></p>
              </div>

              <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-2 py-2 text-left">Item</th>
                      <th className="px-2 py-2 text-right">Qty</th>
                      <th className="px-2 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkoutSummary.items.map((item) => (
                      <tr key={`${item.product_id}-${item.product_name}`} className="border-t border-slate-100">
                        <td className="px-2 py-2 text-slate-700">{item.product_name}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-700">{item.quantity}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-900">{formatTaka(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-sm tabular-nums">
                <div className="flex items-center justify-between"><span>Subtotal</span><span>{formatTaka(checkoutSummary.subtotal)}</span></div>
                <div className="flex items-center justify-between"><span>Discount</span><span>{formatTaka(checkoutSummary.discount_amount)}</span></div>
                <div className="flex items-center justify-between font-semibold text-slate-900"><span>Total</span><span>{formatTaka(checkoutSummary.total)}</span></div>
                <div className="flex items-center justify-between"><span>Paid</span><span>{formatTaka(checkoutSummary.paid)}</span></div>
                <div className="flex items-center justify-between text-amber-700"><span>Due</span><span>{formatTaka(checkoutSummary.due)}</span></div>
                <div className="flex items-center justify-between text-emerald-700"><span>Change</span><span>{formatTaka(checkoutSummary.change)}</span></div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button
                onClick={handleStartNewSale}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                New Sale
              </Button>
              <Button variant="secondary" onClick={() => setCheckoutSummary(null)}>
                Close
              </Button>
              <Button onClick={handlePrintSlip}>
                Print Slip
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
