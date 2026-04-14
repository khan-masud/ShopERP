import type { NextRequest } from "next/server";
import { getUserPermissionMap } from "@/lib/server/permissions";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const permission_map = await getUserPermissionMap(user);

    return jsonOk({ user, permission_map });
  } catch (error) {
    return handleApiError(error);
  }
}
