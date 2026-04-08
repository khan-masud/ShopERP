import { NextResponse } from "next/server";
import { ApiError } from "@/lib/server/errors";

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
};

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(
    { success: true, data },
    {
      status,
      headers: noStoreHeaders,
    },
  );
}

export function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    { success: false, message, details },
    {
      status,
      headers: noStoreHeaders,
    },
  );
}

export function handleApiError(error: unknown) {
  if (error instanceof ApiError) {
    return jsonError(error.message, error.status);
  }

  console.error("Unhandled API error", error);
  return jsonError("Internal server error", 500);
}
