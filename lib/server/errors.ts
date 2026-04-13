export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

type ErrorWithCode = {
  code?: unknown;
  errno?: unknown;
};

const DB_CONNECTION_CAPACITY_CODES = new Set([
  "ER_CON_COUNT_ERROR",
  "ER_TOO_MANY_USER_CONNECTIONS",
]);

export function isDbConnectionCapacityError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as ErrorWithCode;

  if (typeof maybeError.code === "string" && DB_CONNECTION_CAPACITY_CODES.has(maybeError.code)) {
    return true;
  }

  return typeof maybeError.errno === "number" && maybeError.errno === 1040;
}
