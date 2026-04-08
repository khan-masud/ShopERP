"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { formatDateTime, formatTaka } from "@/lib/utils";

type CustomerListItem = {
  id: string;
  name: string | null;
  phone: string;
  address: string | null;
  type: "VIP" | "Regular" | "Wholesale";
  due: string;
  loyalty_points: number;
  sale_count: number;
  total_sales: string;
  total_due_paid: string;
  last_sale_at: string | null;
};

type SaleHistoryItem = {
  id: number;
  total: string;
  paid: string;
  due: string;
  discount_percent: string;
  created_at: string;
};

type DuePaymentItem = {
  id: string;
  sale_id: number | null;
  amount: string;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
};

type CustomerHistoryResponse = {
  customer: {
    id: string;
    name: string | null;
    phone: string;
    address: string | null;
    type: "VIP" | "Regular" | "Wholesale";
    due: string;
    loyalty_points: number;
    created_at: string;
    updated_at: string;
  };
  summary: {
    sale_count: number;
    total_sales: string;
    total_paid: string;
    total_due: string;
    total_due_paid: string;
    last_sale_at: string | null;
  };
  sales: SaleHistoryItem[];
  outstanding_sales: SaleHistoryItem[];
  due_payments: DuePaymentItem[];
};

type CustomersResponse = {
  customers: CustomerListItem[];
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

async function fetchCustomers(search: string, page: number, pageSize: number) {
  const params = new URLSearchParams();
  if (search.trim()) {
    params.set("q", search.trim());
  }
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));

  const res = await fetch(`/api/customers?${params.toString()}`, {
    cache: "no-store",
  });

  const payload = (await res.json()) as
    | ApiSuccess<CustomersResponse>
    | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load customers");
  }

  return payload.data;
}

async function fetchCustomerHistory(phone: string) {
  const res = await fetch(`/api/customers/phone/${encodeURIComponent(phone)}`, {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<CustomerHistoryResponse> | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load customer history");
  }

  return payload.data;
}

export default function CustomersPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedPhone, setSelectedPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [saleId, setSaleId] = useState("");
  const [note, setNote] = useState("");

  const {
    data: customersData,
    isLoading: customersLoading,
    isError: customersError,
  } = useQuery({
    queryKey: ["customers", search, page, pageSize],
    queryFn: () => fetchCustomers(search, page, pageSize),
  });

  const customers = useMemo(() => customersData?.customers ?? [], [customersData]);
  const customersPagination = customersData?.pagination ?? {
    page,
    page_size: pageSize,
    total_count: customers.length,
    total_pages: 1,
  };
  const showingFrom =
    customersPagination.total_count === 0
      ? 0
      : (customersPagination.page - 1) * customersPagination.page_size + 1;
  const showingTo =
    customersPagination.total_count === 0
      ? 0
      : Math.min(
        customersPagination.page * customersPagination.page_size,
        customersPagination.total_count,
      );

  const selectedCustomerExists = useMemo(
    () => customers.some((item) => item.phone === selectedPhone),
    [customers, selectedPhone],
  );

  const fallbackPhone = customers[0]?.phone ?? "";
  const activePhone = selectedCustomerExists ? selectedPhone : (selectedPhone || fallbackPhone);

  const {
    data: history,
    isLoading: historyLoading,
    isError: historyError,
  } = useQuery({
    queryKey: ["customer-history", activePhone],
    queryFn: () => fetchCustomerHistory(activePhone),
    enabled: Boolean(activePhone),
  });

  const collectDueMutation = useMutation({
    mutationFn: async () => {
      if (!activePhone) {
        throw new Error("Select a customer first");
      }

      const parsedAmount = Number(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error("Enter a valid payment amount");
      }

      const res = await fetch(`/api/customers/phone/${encodeURIComponent(activePhone)}/due-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: parsedAmount,
          sale_id: saleId ? Number(saleId) : null,
          note: note.trim() || null,
        }),
      });

      const payload = (await res.json()) as ApiSuccess<unknown> | ApiErrorPayload;

      if (!res.ok || !payload.success) {
        throw new Error((payload as ApiErrorPayload).message ?? "Failed to collect due payment");
      }
    },
    onSuccess: async () => {
      toast.success("Due payment collected");
      setAmount("");
      setSaleId("");
      setNote("");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-history", activePhone] }),
      ]);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <section className="xl:col-span-5">
        <Card className="p-4">
          <div className="mb-4 space-y-2">
            <h2 className="text-xl font-semibold text-slate-900">Customers CRM</h2>
            <p className="text-sm text-slate-500">Search customers by phone and review account status</p>
          </div>

          <Input
            placeholder="Search by phone or name"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className="mb-4"
          />

          {customersLoading ? <p className="text-sm text-slate-500">Loading customers...</p> : null}
          {customersError ? (
            <p className="text-sm text-red-600">Unable to load customers. Check your permission.</p>
          ) : null}

          {!customersLoading && !customersError ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Phone</th>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-right">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={3}>
                        No customers found
                      </td>
                    </tr>
                  ) : (
                    customers.map((item) => {
                      const isActive = item.phone === activePhone;

                      return (
                        <tr
                          key={item.id}
                          className={isActive ? "border-t border-slate-100 bg-blue-50" : "border-t border-slate-100"}
                        >
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="font-medium text-blue-700 hover:underline"
                              onClick={() => setSelectedPhone(item.phone)}
                            >
                              {item.phone}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            <p className="font-medium text-slate-900">{item.name || "Walk-in"}</p>
                            <p className="text-xs text-slate-500">{item.type}</p>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                            {formatTaka(item.due)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

          {!customersLoading && !customersError ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
              <p className="text-xs text-slate-600">
                Showing {showingFrom}-{showingTo} of {customersPagination.total_count}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <span>Rows</span>
                  <select
                    className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                    value={String(customersPagination.page_size)}
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
                  disabled={customersPagination.page <= 1}
                >
                  Previous
                </Button>

                <span className="min-w-24 text-center text-xs text-slate-600">
                  Page {customersPagination.page} of {customersPagination.total_pages}
                </span>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setPage((prev) => Math.min(prev + 1, customersPagination.total_pages))
                  }
                  disabled={customersPagination.page >= customersPagination.total_pages}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      </section>

      <section className="space-y-4 xl:col-span-7">
        {!activePhone ? (
          <Card className="p-5 text-sm text-slate-600">
            Select a customer to view phone-based history and due payment options.
          </Card>
        ) : null}

        {activePhone && historyLoading ? <Card className="p-5 text-sm text-slate-500">Loading customer history...</Card> : null}

        {activePhone && historyError ? (
          <Card className="p-5 text-sm text-red-600">Failed to load customer history.</Card>
        ) : null}

        {history ? (
          <>
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    {history.customer.name || "Walk-in Customer"}
                  </h3>
                  <p className="text-sm text-slate-500">{history.customer.phone}</p>
                  {history.customer.address ? (
                    <p className="text-xs text-slate-500">{history.customer.address}</p>
                  ) : null}
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  Type: <span className="font-semibold">{history.customer.type}</span>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">Total Sales</p>
                  <p className="mt-1 text-base font-semibold text-slate-900 tabular-nums">
                    {formatTaka(history.summary.total_sales)}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">Current Due</p>
                  <p className="mt-1 text-base font-semibold text-amber-700 tabular-nums">
                    {formatTaka(history.customer.due)}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">Due Collected</p>
                  <p className="mt-1 text-base font-semibold text-emerald-700 tabular-nums">
                    {formatTaka(history.summary.total_due_paid)}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">Loyalty Points</p>
                  <p className="mt-1 text-base font-semibold text-slate-900 tabular-nums">
                    {history.customer.loyalty_points}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <h4 className="text-sm font-semibold text-slate-900">Collect Due Payment</h4>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Input
                  label="Amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                />

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-slate-600">Apply To Sale (Optional)</span>
                  <select
                    className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
                    value={saleId}
                    onChange={(event) => setSaleId(event.target.value)}
                  >
                    <option value="">Auto allocate to oldest due sales</option>
                    {history.outstanding_sales.map((sale) => (
                      <option key={sale.id} value={sale.id}>
                        Sale #{sale.id} - Due {formatTaka(sale.due)}
                      </option>
                    ))}
                  </select>
                </label>

                <Input
                  label="Note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Optional note"
                  className="md:col-span-2"
                />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  Outstanding due: <span className="font-semibold text-amber-700">{formatTaka(history.customer.due)}</span>
                </p>
                <Button onClick={() => collectDueMutation.mutate()} disabled={collectDueMutation.isPending}>
                  {collectDueMutation.isPending ? "Collecting..." : "Collect Due"}
                </Button>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-slate-200 px-4 py-3">
                <h4 className="text-sm font-semibold text-slate-900">Recent Sales</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Sale</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-right">Paid</th>
                      <th className="px-3 py-2 text-right">Due</th>
                      <th className="px-3 py-2 text-left">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.sales.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                          No sales found
                        </td>
                      </tr>
                    ) : (
                      history.sales.map((sale) => (
                        <tr key={sale.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-medium text-slate-900">#{sale.id}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatTaka(sale.total)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatTaka(sale.paid)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                            {formatTaka(sale.due)}
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
                <h4 className="text-sm font-semibold text-slate-900">Due Payment History</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Payment</th>
                      <th className="px-3 py-2 text-left">Sale</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-left">Collected By</th>
                      <th className="px-3 py-2 text-left">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.due_payments.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                          No due payments recorded
                        </td>
                      </tr>
                    ) : (
                      history.due_payments.map((payment) => (
                        <tr key={payment.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-xs text-slate-600">{payment.note || "-"}</td>
                          <td className="px-3 py-2 text-slate-700">
                            {payment.sale_id ? `#${payment.sale_id}` : "Auto"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                            {formatTaka(payment.amount)}
                          </td>
                          <td className="px-3 py-2 text-slate-700">{payment.created_by_name || "System"}</td>
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
          </>
        ) : null}
      </section>
    </div>
  );
}
