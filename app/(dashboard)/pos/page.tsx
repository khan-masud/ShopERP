"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { formatTaka } from "@/lib/utils";

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

function generateIdempotencyKey(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function fetchProducts(search: string, page: number, pageSize: number) {
  const params = new URLSearchParams();
  if (search) {
    params.set("q", search);
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

  return {
    ...safeData,
    products: safeData.products.filter((item) => item.stock > 0),
  };
}

export default function POSPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [productPage, setProductPage] = useState(1);
  const [productPageSize, setProductPageSize] = useState(50);
  const [cart, setCart] = useState<Record<string, CartItem>>({});

  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);

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

  const cartItems = useMemo(() => Object.values(cart), [cart]);

  const subtotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + Number(item.product.sell_price) * item.quantity, 0),
    [cartItems],
  );

  const discountAmount = (subtotal * discountPercent) / 100;
  const total = Math.max(subtotal - discountAmount, 0);
  const due = Math.max(total - paidAmount, 0);
  const change = Math.max(paidAmount - total, 0);

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev[product.id];
      const currentQty = existing?.quantity ?? 0;
      const nextQty = Math.min(currentQty + 1, product.stock);

      return {
        ...prev,
        [product.id]: {
          product,
          quantity: nextQty,
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
          discount_percent: discountPercent,
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
        data?: {
          sale_id: number;
          total: number;
          due: number;
          change: number;
        };
      };

      if (!res.ok || !payload.success) {
        throw new Error(payload.message ?? "Checkout failed");
      }

      return payload.data;
    },
    onSuccess: (data) => {
      toast.success(`Sale #${data?.sale_id ?? ""} completed`);
      setCart({});
      setCustomerName("");
      setCustomerAddress("");
      setDiscountPercent(0);
      setPaidAmount(0);
      queryClient.invalidateQueries({ queryKey: ["pos-products"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
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
            {products.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => addToCart(product)}
                className="rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-blue-300 hover:bg-blue-50"
              >
                <p className="line-clamp-1 text-sm font-semibold text-slate-900">{product.name}</p>
                <p className="mt-1 text-xs text-slate-500">{product.category}</p>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="font-semibold text-blue-700">{formatTaka(product.sell_price)}</span>
                  <span className="tabular-nums text-slate-600">Stock {product.stock}</span>
                </div>
              </button>
            ))}
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
                      <span className="min-w-8 px-2 text-center text-sm tabular-nums">{item.quantity}</span>
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
              label="Discount %"
              type="number"
              min={0}
              max={100}
              value={discountPercent}
              onChange={(event) => setDiscountPercent(Number(event.target.value || 0))}
            />
            <Input
              label="Paid Amount"
              type="number"
              min={0}
              value={paidAmount}
              onChange={(event) => setPaidAmount(Number(event.target.value || 0))}
            />

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
                onClick={() => checkoutMutation.mutate()}
                disabled={checkoutMutation.isPending || cartItems.length === 0}
              >
                {checkoutMutation.isPending ? "Processing..." : "Checkout"}
              </Button>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
