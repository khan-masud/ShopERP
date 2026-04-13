"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { StatCard } from "@/components/ui/StatCard";
import { formatTaka } from "@/lib/utils";

const categories = [
  "Food",
  "Beverages",
  "Cleaning",
  "Personal Care",
  "Snacks",
  "Household",
  "Other",
] as const;

type Product = {
  id: string;
  name: string;
  category: (typeof categories)[number];
  sku: string;
  unit: string;
  buy_price: string;
  sell_price: string;
  stock: number;
  min_stock: number;
  supplier: string | null;
  expiry_date: string | null;
  is_active: number;
};

const createProductSchema = z.object({
  name: z.string().min(2),
  category: z.enum(categories),
  sku: z.string().optional(),
  unit: z.string().min(1),
  buy_price: z.number().nonnegative(),
  sell_price: z.number().positive(),
  stock: z.number().int().nonnegative(),
  min_stock: z.number().int().nonnegative(),
  supplier: z.string().optional(),
  expiry_date: z.string().optional(),
});

type CreateProductValues = z.infer<typeof createProductSchema>;
type StockStatusFilter = "all" | "low_stock" | "out_of_stock";
type ExpiryStatusFilter = "all" | "expiring_30d";

const defaultProductFormValues: CreateProductValues = {
  name: "",
  category: "Food",
  unit: "pcs",
  stock: 0,
  min_stock: 10,
  buy_price: 0,
  sell_price: 0,
  supplier: "",
  sku: "",
  expiry_date: "",
};

type ProductsResponse = {
  products: Product[];
  pagination: {
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
  };
  summary: {
    low_stock_count: number;
    stock_out_count: number;
    expiring_soon_count: number;
    total_product_value: number;
  };
};

async function fetchProducts(
  search: string,
  category: string,
  stockStatus: StockStatusFilter,
  expiryStatus: ExpiryStatusFilter,
  page: number,
  pageSize: number,
) {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (category) params.set("category", category);
  if (stockStatus !== "all") params.set("stockStatus", stockStatus);
  if (expiryStatus !== "all") params.set("expiryStatus", expiryStatus);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));

  const res = await fetch(`/api/products?${params.toString()}`, {
    cache: "no-store",
  });

  const payload = (await res.json()) as {
    success: boolean;
    data?: ProductsResponse;
    message?: string;
  };

  if (!res.ok || !payload.success) {
    throw new Error(payload.message ?? "Failed to fetch products");
  }

  return payload.data;
}

export default function ProductsPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [stockStatus, setStockStatus] = useState<StockStatusFilter>("all");
  const [expiryStatus, setExpiryStatus] = useState<ExpiryStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showCreate, setShowCreate] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["products", search, category, stockStatus, expiryStatus, page, pageSize],
    queryFn: () => fetchProducts(search, category, stockStatus, expiryStatus, page, pageSize),
  });

  const { data: summaryData } = useQuery({
    queryKey: ["products-summary-static"],
    queryFn: () => fetchProducts("", "", "all", "all", 1, 1),
    staleTime: 60_000,
  });

  const products = data?.products ?? [];
  const pagination = data?.pagination ?? {
    page,
    page_size: pageSize,
    total_count: products.length,
    total_pages: 1,
  };
  const totalProductsCount = summaryData?.pagination.total_count ?? 0;
  const lowStockCount = summaryData?.summary.low_stock_count ?? 0;
  const stockOutCount = summaryData?.summary.stock_out_count ?? 0;
  const expiringSoonCount = summaryData?.summary.expiring_soon_count ?? 0;
  const totalProductValue = summaryData?.summary.total_product_value ?? 0;
  const showingFrom =
    pagination.total_count === 0 ? 0 : (pagination.page - 1) * pagination.page_size + 1;
  const showingTo =
    pagination.total_count === 0
      ? 0
      : Math.min(pagination.page * pagination.page_size, pagination.total_count);

  const form = useForm<CreateProductValues>({
    resolver: zodResolver(createProductSchema),
    defaultValues: defaultProductFormValues,
  });

  const isEditMode = editingProduct !== null;

  const createMutation = useMutation({
    mutationFn: async (values: CreateProductValues) => {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });

      const payload = (await res.json()) as {
        success: boolean;
        message?: string;
      };

      if (!res.ok || !payload.success) {
        throw new Error(payload.message ?? "Failed to create product");
      }
    },
    onSuccess: () => {
      toast.success("Product added successfully");
      setShowCreate(false);
      setEditingProduct(null);
      form.reset(defaultProductFormValues);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["products-summary-static"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      productId,
      values,
    }: {
      productId: string;
      values: CreateProductValues;
    }) => {
      const res = await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });

      const payload = (await res.json()) as {
        success: boolean;
        message?: string;
      };

      if (!res.ok || !payload.success) {
        throw new Error(payload.message ?? "Failed to update product");
      }
    },
    onSuccess: () => {
      toast.success("Product updated successfully");
      setShowCreate(false);
      setEditingProduct(null);
      form.reset(defaultProductFormValues);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["products-summary-static"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (productId: string) => {
      const res = await fetch(`/api/products/${productId}`, {
        method: "DELETE",
      });

      const payload = (await res.json()) as {
        success: boolean;
        message?: string;
      };

      if (!res.ok || !payload.success) {
        throw new Error(payload.message ?? "Failed to delete product");
      }
    },
    onSuccess: (_data, productId) => {
      toast.success("Product deleted successfully");

      if (editingProduct?.id === productId) {
        closeForm();
      }

      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["products-summary-static"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
    onSettled: () => {
      setDeletingProductId(null);
    },
  });

  function toDateInputValue(value: string | null) {
    if (!value) {
      return "";
    }

    return value.slice(0, 10);
  }

  function openCreateForm() {
    setEditingProduct(null);
    form.reset(defaultProductFormValues);
    setShowCreate((prev) => !prev);
  }

  function openEditForm(product: Product) {
    setEditingProduct(product);
    setShowCreate(true);
    form.reset({
      name: product.name,
      category: product.category,
      sku: product.sku,
      unit: product.unit,
      buy_price: Number(product.buy_price ?? 0),
      sell_price: Number(product.sell_price ?? 0),
      stock: Number(product.stock ?? 0),
      min_stock: Number(product.min_stock ?? 0),
      supplier: product.supplier ?? "",
      expiry_date: toDateInputValue(product.expiry_date),
    });
  }

  function closeForm() {
    setShowCreate(false);
    setEditingProduct(null);
    form.reset(defaultProductFormValues);
  }

  function handleDeleteProduct(product: Product) {
    const shouldDelete = window.confirm(`Delete product \"${product.name}\"?`);
    if (!shouldDelete) {
      return;
    }

    setDeletingProductId(product.id);
    deleteMutation.mutate(product.id);
  }

  function applyStockStatusCardFilter(nextStockStatus: StockStatusFilter) {
    setStockStatus(nextStockStatus);
    setExpiryStatus("all");
    setPage(1);
  }

  function handleTotalProductsCardClick() {
    applyStockStatusCardFilter("all");
  }

  function handleLowStockCardClick() {
    applyStockStatusCardFilter(stockStatus === "low_stock" ? "all" : "low_stock");
  }

  function handleOutOfStockCardClick() {
    applyStockStatusCardFilter(stockStatus === "out_of_stock" ? "all" : "out_of_stock");
  }

  function handleExpiringSoonCardClick() {
    setStockStatus("all");
    setExpiryStatus((prev) => (prev === "expiring_30d" ? "all" : "expiring_30d"));
    setPage(1);
  }

  async function copySku(sku: string) {
    try {
      await navigator.clipboard.writeText(sku);
      toast.success("SKU copied");
    } catch {
      toast.error("Failed to copy SKU");
    }
  }

  function getExpiryBadge(expiryDate: string | null) {
    if (!expiryDate) return null;

    const expiry = new Date(expiryDate);
    const now = new Date();
    const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysLeft < 0) {
      return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">Expired</span>;
    }

    if (daysLeft <= 30) {
      return (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
          {daysLeft}d left
        </span>
      );
    }

    return null;
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <button
          type="button"
          onClick={handleTotalProductsCardClick}
          className="rounded-xl text-left transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          aria-pressed={stockStatus === "all" && expiryStatus === "all"}
          title="Show all products"
        >
          <StatCard
            title="Total Products"
            value={String(totalProductsCount)}
            accent="blue"
            hint={stockStatus === "all" && expiryStatus === "all" ? "Filter active" : "Click to filter"}
          />
        </button>
        <button
          type="button"
          onClick={handleLowStockCardClick}
          className="rounded-xl text-left transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          aria-pressed={stockStatus === "low_stock"}
          title={stockStatus === "low_stock" ? "Show all products" : "Show low stock products"}
        >
          <StatCard
            title="Low Stock"
            value={String(lowStockCount)}
            accent="orange"
            hint={stockStatus === "low_stock" ? "Filter active" : "Click to filter"}
          />
        </button>
        <button
          type="button"
          onClick={handleOutOfStockCardClick}
          className="rounded-xl text-left transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          aria-pressed={stockStatus === "out_of_stock"}
          title={stockStatus === "out_of_stock" ? "Show all products" : "Show out of stock products"}
        >
          <StatCard
            title="Out of Stock"
            value={String(stockOutCount)}
            accent="red"
            hint={stockStatus === "out_of_stock" ? "Filter active" : "Click to filter"}
          />
        </button>
        <button
          type="button"
          onClick={handleExpiringSoonCardClick}
          className="rounded-xl text-left transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          aria-pressed={expiryStatus === "expiring_30d"}
          title={
            expiryStatus === "expiring_30d"
              ? "Show all products"
              : "Show products expiring within 30 days"
          }
        >
          <StatCard
            title="Expiring in 30 Days"
            value={String(expiringSoonCount)}
            accent="orange"
            hint={expiryStatus === "expiring_30d" ? "Filter active" : "Click to filter"}
          />
        </button>
        <StatCard title="Total Product Value" value={formatTaka(totalProductValue)} accent="green" />
      </div>

      {showCreate ? (
        <Card className="p-4">
          <form
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
            onSubmit={form.handleSubmit((values) => {
              if (editingProduct) {
                updateMutation.mutate({ productId: editingProduct.id, values });
                return;
              }

              createMutation.mutate(values);
            })}
          >
            <div className="md:col-span-2 xl:col-span-4">
              <h3 className="text-sm font-semibold text-slate-900">
                {isEditMode ? "Edit Product" : "Add New Product"}
              </h3>
            </div>

            <Input label="Name" {...form.register("name")} error={form.formState.errors.name?.message} />

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">Category</span>
              <select
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
                {...form.register("category")}
              >
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <Input label="SKU (optional)" {...form.register("sku")} />
            <Input label="Unit" {...form.register("unit")} />
            <Input
              label="Buy Price"
              type="number"
              step="0.01"
              {...form.register("buy_price", { valueAsNumber: true })}
            />
            <Input
              label="Sell Price"
              type="number"
              step="0.01"
              {...form.register("sell_price", { valueAsNumber: true })}
            />
            <Input
              label="Stock"
              type="number"
              disabled={isEditMode}
              {...form.register("stock", { valueAsNumber: true })}
            />
            <Input
              label="Min Stock"
              type="number"
              {...form.register("min_stock", { valueAsNumber: true })}
            />
            <Input label="Supplier" {...form.register("supplier")} />
            <Input label="Expiry Date" type="date" {...form.register("expiry_date")} />

            <div className="md:col-span-2 xl:col-span-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {createMutation.isPending || updateMutation.isPending
                    ? isEditMode
                      ? "Updating..."
                      : "Adding..."
                    : isEditMode
                      ? "Update Product"
                      : "Save Product"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeForm}
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="p-4">
        <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center">
          <Input
            placeholder="Search by name or SKU"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <label className="flex flex-col">
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              aria-label="Category"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              aria-label="Stock status"
              value={stockStatus}
              onChange={(event) => {
                setStockStatus(event.target.value as StockStatusFilter);
                setPage(1);
              }}
            >
              <option value="all">All stock</option>
              <option value="low_stock">Low stock</option>
              <option value="out_of_stock">Out of stock</option>
            </select>
          </label>
          <Button onClick={openCreateForm} className="h-10 w-full gap-1.5 lg:w-auto">
            <Plus size={14} />
            {showCreate && !isEditMode ? "Close Form" : "Add Product"}
          </Button>
        </div>

        {isLoading ? <div className="py-8 text-sm text-slate-500">Loading products...</div> : null}
        {isError ? (
          <div className="py-8 text-sm text-red-600">Failed to load products. Please check permissions.</div>
        ) : null}

        {!isLoading && !isError ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-right">Buy</th>
                  <th className="px-3 py-2 text-right">Sell</th>
                  <th className="px-3 py-2 text-right">Stock</th>
                  <th className="px-2 py-2 text-left">Expiry</th>
                  <th className="px-1 py-2 text-left whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                      No products found
                    </td>
                  </tr>
                ) : (
                  products.map((item) => (
                    <tr
                      key={item.id}
                      className={
                        item.stock <= item.min_stock
                          ? "border-t border-slate-100 bg-orange-50/70"
                          : "border-t border-slate-100"
                      }
                    >
                      <td className="px-3 py-2 font-medium text-slate-900">{item.name}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs"
                          onClick={() => copySku(item.sku)}
                        >
                          {item.sku}
                          <Copy size={12} />
                        </button>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{item.category}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatTaka(item.buy_price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatTaka(item.sell_price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span
                          className={
                            item.stock <= item.min_stock
                              ? "font-semibold text-amber-700"
                              : "text-slate-800"
                          }
                        >
                          {item.stock}
                        </span>
                      </td>
                      <td className="px-2 py-2">{getExpiryBadge(item.expiry_date)}</td>
                      <td className="px-1 py-2 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEditForm(item)}
                            disabled={deleteMutation.isPending && deletingProductId === item.id}
                            className="h-9 w-9 border border-slate-200 bg-slate-100 p-0 text-slate-700 hover:bg-slate-200"
                            aria-label={`Edit ${item.name}`}
                            title="Edit"
                          >
                            <Pencil size={16} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteProduct(item)}
                            disabled={deleteMutation.isPending && deletingProductId === item.id}
                            className="h-9 w-9 border border-slate-200 bg-slate-100 p-0 text-slate-700 hover:bg-slate-200"
                            aria-label={`Delete ${item.name}`}
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        {!isLoading && !isError ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
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
    </div>
  );
}
