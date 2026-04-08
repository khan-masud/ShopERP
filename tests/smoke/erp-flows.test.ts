import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

type ApiSuccess<T> = {
  success: true;
  data: T;
};

type ApiErrorPayload = {
  success: false;
  message?: string;
};

type ExpenseResponse = {
  expense: {
    id: string;
    title: string;
  };
};

type ExpenseListResponse = {
  expenses: Array<{
    id: string;
    title: string;
  }>;
};

type AuditResponse = {
  logs: Array<{
    id: string;
    action: string;
    detail: string;
  }>;
  total_count: number;
  page: number;
  page_size: number;
  total_pages: number;
};

type StockResponse = {
  products: Array<{
    id: string;
    sku: string;
    stock: number;
  }>;
  history: Array<{
    id: string;
    note: string | null;
  }>;
  history_pagination: {
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
  };
};

type StockAdjustResponse = {
  product_id: string;
  quantity_before: number;
  quantity_after: number;
};

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const adminEmail = process.env.SMOKE_ADMIN_EMAIL ?? "";
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD ?? "";
const smokeEnabled = Boolean(adminEmail && adminPassword);

class ApiSession {
  private readonly baseUrl: string;

  private readonly cookies = new Map<string, string>();

  constructor(url: string) {
    this.baseUrl = url;
  }

  async login(email: string, password: string) {
    const { response, json } = await this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    assert.equal(response.status, 200, "Login should return HTTP 200");
    assertApiSuccess<{ user: { id: string; email: string } }>(json, "login response");
    assert.equal(json.data.user.email.toLowerCase(), email.toLowerCase());
  }

  async request(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);

    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const cookieHeader = this.buildCookieHeader();
    if (cookieHeader) {
      headers.set("Cookie", cookieHeader);
    }

    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers,
    });

    this.captureCookies(response);

    const raw = await response.text();
    let json: unknown = null;

    if (raw) {
      try {
        json = JSON.parse(raw) as unknown;
      } catch {
        json = raw;
      }
    }

    return {
      response,
      json,
    };
  }

  private captureCookies(response: Response) {
    const headerBag = response.headers as Headers & {
      getSetCookie?: () => string[];
    };

    const setCookieHeaders =
      typeof headerBag.getSetCookie === "function"
        ? headerBag.getSetCookie()
        : response.headers.get("set-cookie")
          ? [response.headers.get("set-cookie") as string]
          : [];

    for (const header of setCookieHeaders) {
      const pair = header.split(";")[0];
      const separator = pair.indexOf("=");

      if (separator <= 0) {
        continue;
      }

      const key = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      this.cookies.set(key, value);
    }
  }

  private buildCookieHeader() {
    if (this.cookies.size === 0) {
      return "";
    }

    return Array.from(this.cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }
}

function assertApiSuccess<T>(payload: unknown, context: string): asserts payload is ApiSuccess<T> {
  assert.ok(payload && typeof payload === "object", `${context} should be JSON object`);

  const maybePayload = payload as Partial<ApiSuccess<T> & ApiErrorPayload>;
  assert.equal(
    maybePayload.success,
    true,
    `${context} failed: ${maybePayload.message ?? "unknown error"}`,
  );
}

function todayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

function marker(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

const session = new ApiSession(baseUrl);

before(async () => {
  if (!smokeEnabled) {
    return;
  }

  await session.login(adminEmail, adminPassword);
});

describe("ShopERP smoke flows", () => {
  test("expense create and delete flow", { skip: !smokeEnabled }, async () => {
    const smokeMarker = marker("SMOKE-EXPENSE");
    const title = `${smokeMarker} Expense`;

    const createResponse = await session.request("/api/expenses", {
      method: "POST",
      body: JSON.stringify({
        title,
        amount: 111.5,
        category: "Other",
        note: smokeMarker,
        expense_date: todayDateInput(),
      }),
    });

    assert.equal(createResponse.response.status, 201, "Expense create should return HTTP 201");
    assertApiSuccess<ExpenseResponse>(createResponse.json, "expense create");

    const expenseId = createResponse.json.data.expense.id;

    const listedResponse = await session.request(`/api/expenses?q=${encodeURIComponent(smokeMarker)}`);
    assert.equal(listedResponse.response.status, 200, "Expense listing should return HTTP 200");
    assertApiSuccess<ExpenseListResponse>(listedResponse.json, "expense list after create");
    assert.ok(
      listedResponse.json.data.expenses.some((item) => item.id === expenseId),
      "Created expense should appear in filtered list",
    );

    const deleteResponse = await session.request(`/api/expenses/${expenseId}`, {
      method: "DELETE",
    });

    assert.equal(deleteResponse.response.status, 200, "Expense delete should return HTTP 200");
    assertApiSuccess<{ expense: { id: string } }>(deleteResponse.json, "expense delete");

    const afterDeleteResponse = await session.request(`/api/expenses?q=${encodeURIComponent(smokeMarker)}`);
    assert.equal(afterDeleteResponse.response.status, 200, "Expense list after delete should return HTTP 200");
    assertApiSuccess<ExpenseListResponse>(afterDeleteResponse.json, "expense list after delete");
    assert.equal(
      afterDeleteResponse.json.data.expenses.some((item) => item.id === expenseId),
      false,
      "Deleted expense should not remain in filtered list",
    );
  });

  test("audit filtering flow", { skip: !smokeEnabled }, async () => {
    const smokeMarker = marker("SMOKE-AUDIT");

    const createResponse = await session.request("/api/expenses", {
      method: "POST",
      body: JSON.stringify({
        title: `${smokeMarker} Expense`,
        amount: 99,
        category: "Other",
        note: smokeMarker,
        expense_date: todayDateInput(),
      }),
    });

    assert.equal(createResponse.response.status, 201, "Setup expense create should return HTTP 201");
    assertApiSuccess<ExpenseResponse>(createResponse.json, "setup expense create");
    const expenseId = createResponse.json.data.expense.id;

    const deleteResponse = await session.request(`/api/expenses/${expenseId}`, {
      method: "DELETE",
    });
    assert.equal(deleteResponse.response.status, 200, "Setup expense delete should return HTTP 200");
    assertApiSuccess<{ expense: { id: string } }>(deleteResponse.json, "setup expense delete");

    const auditResponse = await session.request(
      `/api/audit?action=Expense&q=${encodeURIComponent(smokeMarker)}&page=1&pageSize=10`,
    );

    assert.equal(auditResponse.response.status, 200, "Audit query should return HTTP 200");
    assertApiSuccess<AuditResponse>(auditResponse.json, "audit filter");

    assert.equal(auditResponse.json.data.page, 1);
    assert.equal(auditResponse.json.data.page_size, 10);
    assert.ok(auditResponse.json.data.total_pages >= 1, "Audit response should include total pages");
    assert.ok(auditResponse.json.data.total_count >= 1, "Audit filtering should return at least one record");
    assert.ok(
      auditResponse.json.data.logs.some(
        (log) => log.detail.includes(smokeMarker) || log.action.toLowerCase().includes("expense"),
      ),
      "Audit logs should include a matching expense-related record",
    );
  });

  test("stock adjustment flow", { skip: !smokeEnabled }, async () => {
    const stockResponse = await session.request("/api/stock?historyPage=1&historyPageSize=10");

    assert.equal(stockResponse.response.status, 200, "Stock list should return HTTP 200");
    assertApiSuccess<StockResponse>(stockResponse.json, "stock list");

    assert.ok(stockResponse.json.data.products.length > 0, "At least one product is required for stock smoke test");

    const product = stockResponse.json.data.products[0];
    const stockBefore = product.stock;
    const smokeMarker = marker("SMOKE-STOCK");

    let incrementApplied = false;

    try {
      const plusResponse = await session.request("/api/stock", {
        method: "POST",
        body: JSON.stringify({
          product_id: product.id,
          change_type: "adjustment",
          quantity_change: 1,
          note: `${smokeMarker} plus`,
        }),
      });

      assert.equal(plusResponse.response.status, 201, "Stock increment should return HTTP 201");
      assertApiSuccess<StockAdjustResponse>(plusResponse.json, "stock increment");
      incrementApplied = true;

      const minusResponse = await session.request("/api/stock", {
        method: "POST",
        body: JSON.stringify({
          product_id: product.id,
          change_type: "adjustment",
          quantity_change: -1,
          note: `${smokeMarker} minus`,
        }),
      });

      assert.equal(minusResponse.response.status, 201, "Stock decrement should return HTTP 201");
      assertApiSuccess<StockAdjustResponse>(minusResponse.json, "stock decrement");
      incrementApplied = false;

      const verifyResponse = await session.request(`/api/stock?q=${encodeURIComponent(product.sku)}&historyPage=1&historyPageSize=10`);
      assert.equal(verifyResponse.response.status, 200, "Stock verify query should return HTTP 200");
      assertApiSuccess<StockResponse>(verifyResponse.json, "stock verify");

      const verifiedProduct = verifyResponse.json.data.products.find((item) => item.id === product.id);
      assert.ok(verifiedProduct, "Updated product should still be queryable by SKU");
      assert.equal(verifiedProduct.stock, stockBefore, "Stock should return to original quantity");

      const historyResponse = await session.request(
        `/api/stock?q=${encodeURIComponent(smokeMarker)}&historyPage=1&historyPageSize=50`,
      );
      assert.equal(historyResponse.response.status, 200, "Stock history query should return HTTP 200");
      assertApiSuccess<StockResponse>(historyResponse.json, "stock history verify");

      assert.ok(
        historyResponse.json.data.history.filter((row) => row.note?.includes(smokeMarker)).length >= 2,
        "Stock history should include both smoke adjustment entries",
      );
    } finally {
      if (incrementApplied) {
        await session.request("/api/stock", {
          method: "POST",
          body: JSON.stringify({
            product_id: product.id,
            change_type: "adjustment",
            quantity_change: -1,
            note: `${smokeMarker} cleanup`,
          }),
        });
      }
    }
  });
});
