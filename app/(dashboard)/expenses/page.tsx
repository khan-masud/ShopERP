"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { StatCard } from "@/components/ui/StatCard";
import { formatDateTime, formatTaka } from "@/lib/utils";

const expenseCategories = ["Rent", "Electricity", "Salary", "Purchase", "Transport", "Other"] as const;
type ExpenseCategory = (typeof expenseCategories)[number];

type ExpenseItem = {
  id: string;
  title: string;
  amount: string;
  category: ExpenseCategory;
  note: string | null;
  expense_date: string;
  created_at: string;
  created_by_name: string | null;
};

type CategorySummaryItem = {
  category: ExpenseCategory;
  expense_count: number;
  total_amount: number;
};

type ExpensesResponse = {
  expenses: ExpenseItem[];
  summary: {
    expense_count: number;
    total_amount: number;
  };
  categories: CategorySummaryItem[];
};

type ApiSuccess<T> = {
  success: true;
  data: T;
};

type ApiErrorPayload = {
  success: false;
  message?: string;
};

function formatInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function fetchExpenses(filters: {
  search: string;
  category: string;
  fromDate: string;
  toDate: string;
}) {
  const params = new URLSearchParams();

  if (filters.search.trim()) {
    params.set("q", filters.search.trim());
  }

  if (filters.category) {
    params.set("category", filters.category);
  }

  if (filters.fromDate) {
    params.set("from", filters.fromDate);
  }

  if (filters.toDate) {
    params.set("to", filters.toDate);
  }

  const query = params.toString();
  const res = await fetch(query ? `/api/expenses?${query}` : "/api/expenses", {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<ExpensesResponse> | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load expenses");
  }

  return payload.data;
}

export default function ExpensesPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategory>("Purchase");
  const [expenseDate, setExpenseDate] = useState(formatInputDate(new Date()));
  const [note, setNote] = useState("");

  const {
    data,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["expenses-module", search, category, fromDate, toDate],
    queryFn: () => fetchExpenses({ search, category, fromDate, toDate }),
  });

  const addExpenseMutation = useMutation({
    mutationFn: async () => {
      const parsedAmount = Number(amount);

      if (!title.trim()) {
        throw new Error("Expense title is required");
      }

      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error("Enter a valid amount");
      }

      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          amount: parsedAmount,
          category: expenseCategory,
          note: note.trim() || null,
          expense_date: expenseDate,
        }),
      });

      const payload = (await res.json()) as ApiSuccess<{ expense: ExpenseItem }> | ApiErrorPayload;

      if (!res.ok || !payload.success) {
        throw new Error((payload as ApiErrorPayload).message ?? "Failed to add expense");
      }

      return payload.data;
    },
    onSuccess: async () => {
      toast.success("Expense added");
      setTitle("");
      setAmount("");
      setNote("");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["expenses-module"] }),
        queryClient.invalidateQueries({ queryKey: ["reports-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["reports-range"] }),
      ]);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: async (expenseId: string) => {
      const res = await fetch(`/api/expenses/${expenseId}`, {
        method: "DELETE",
      });

      const payload = (await res.json()) as ApiSuccess<unknown> | ApiErrorPayload;

      if (!res.ok || !payload.success) {
        throw new Error((payload as ApiErrorPayload).message ?? "Failed to delete expense");
      }
    },
    onSuccess: async () => {
      toast.success("Expense deleted");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["expenses-module"] }),
        queryClient.invalidateQueries({ queryKey: ["reports-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["reports-range"] }),
      ]);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function confirmAndDeleteExpense(expense: ExpenseItem) {
    const confirmed = window.confirm(
      `Delete expense \"${expense.title}\"? This action cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    deleteExpenseMutation.mutate(expense.id);
  }

  const expenses = data?.expenses ?? [];
  const summary = data?.summary ?? { expense_count: 0, total_amount: 0 };
  const categories = useMemo(() => data?.categories ?? [], [data]);

  const topCategory = useMemo(() => categories[0] ?? null, [categories]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Expense Management</h2>
        <p className="text-sm text-slate-500">Track expenses, monitor totals, and maintain accurate net profit data</p>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input
            label="Search"
            placeholder="Title or note"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="xl:col-span-2"
          />

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Category</span>
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">All Categories</option>
              {expenseCategories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <Input
            label="From"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />

          <Input
            label="To"
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </div>

        <div className="mt-3 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setCategory("");
              setFromDate("");
              setToDate("");
            }}
          >
            Clear Filters
          </Button>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard title="Expense Entries" value={String(summary.expense_count)} accent="blue" />
        <StatCard title="Total Expense" value={formatTaka(summary.total_amount)} accent="red" />
        <StatCard
          title="Top Category"
          value={topCategory ? `${topCategory.category} (${formatTaka(topCategory.total_amount)})` : "N/A"}
          accent="orange"
        />
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-900">Add New Expense</h3>

        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input
            label="Title"
            placeholder="e.g. Monthly electricity bill"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="xl:col-span-2"
          />

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
            <span className="text-xs font-medium text-slate-600">Category</span>
            <select
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              value={expenseCategory}
              onChange={(event) => setExpenseCategory(event.target.value as ExpenseCategory)}
            >
              {expenseCategories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <Input
            label="Expense Date"
            type="date"
            value={expenseDate}
            onChange={(event) => setExpenseDate(event.target.value)}
          />

          <Input
            label="Note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional"
            className="md:col-span-2 xl:col-span-4"
          />

          <div className="flex items-end justify-end">
            <Button onClick={() => addExpenseMutation.mutate()} disabled={addExpenseMutation.isPending}>
              {addExpenseMutation.isPending ? "Saving..." : "Add Expense"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Expense Ledger</h3>
        </div>

        {isLoading ? <p className="px-4 py-6 text-sm text-slate-500">Loading expenses...</p> : null}
        {isError ? <p className="px-4 py-6 text-sm text-red-600">Failed to load expenses.</p> : null}

        {!isLoading && !isError ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Title</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Created By</th>
                  <th className="px-3 py-2 text-left">Note</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-slate-500" colSpan={7}>
                      No expenses found
                    </td>
                  </tr>
                ) : (
                  expenses.map((item) => (
                    <tr key={item.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(item.expense_date)}</td>
                      <td className="px-3 py-2 font-medium text-slate-900">{item.title}</td>
                      <td className="px-3 py-2 text-slate-700">{item.category}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-700">{formatTaka(item.amount)}</td>
                      <td className="px-3 py-2 text-slate-700">{item.created_by_name || "System"}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{item.note || "-"}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => confirmAndDeleteExpense(item)}
                          disabled={deleteExpenseMutation.isPending}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
