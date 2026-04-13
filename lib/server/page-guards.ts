import { redirect } from "next/navigation";
import { type ModuleKey, type PermissionAction } from "@/lib/server/constants";
import { ApiError } from "@/lib/server/errors";
import { assertPermission } from "@/lib/server/permissions";
import { requireUserForPage } from "@/lib/server/require-user";

export async function guardModulePage(moduleKey: ModuleKey, action: PermissionAction = "view") {
  const user = await requireUserForPage();

  try {
    await assertPermission(user, moduleKey, action);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      redirect("/dashboard");
    }

    throw error;
  }

  return user;
}

export async function guardAdminPage() {
  const user = await requireUserForPage();

  if (user.role !== "admin") {
    redirect("/dashboard");
  }

  return user;
}
