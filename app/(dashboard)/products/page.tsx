"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
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
  };
};

async function fetchProducts(search: string, category: string, page: number, pageSize: number) {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (category) params.set("category", category);
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showCreate, setShowCreate] = useState(false);

  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["products", search, category, page, pageSize],
    queryFn: () => fetchProducts(search, category, page, pageSize),
  });

  const products = data?.products ?? [];
  const pagination = data?.pagination ?? {
    page,
    page_size: pageSize,
    total_count: products.length,
    total_pages: 1,
  };
  const lowStockCount = data?.summary.low_stock_count ?? 0;
  const showingFrom =
    pagination.total_count === 0 ? 0 : (pagination.page - 1) * pagination.page_size + 1;
  const showingTo =
    pagination.total_count === 0
      ? 0
      : Math.min(pagination.page * pagination.page_size, pagination.total_count);

  const form = useForm<CreateProductValues>({
    resolver: zodResolver(createProductSchema),
    defaultValues: {
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
    },
  });

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
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Product Management</h2>
          <p className="text-sm text-slate-500">Manage stock, pricing, and SKU values</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Low stock: <span className="font-semibold">{lowStockCount}</span>
          </div>
          <Button onClick={() => setShowCreate((prev) => !prev)} className="gap-1.5">
            <Plus size={14} />
            {showCreate ? "Close Form" : "Add Product"}
          </Button>
        </div>
      </div>

      {showCreate ? (
        <Card className="p-4">
          <form
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
            onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}
          >
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
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Adding..." : "Save Product"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="p-4">
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="Search by name or SKU"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Category Filter</span>
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
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
                  <th className="px-3 py-2 text-left">Expiry</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
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
                      <td className="px-3 py-2">{getExpiryBadge(item.expiry_date)}</td>
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
