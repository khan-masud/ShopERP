import type { NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    return jsonOk({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
