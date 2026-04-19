import type { NextRequest } from "next/server";
import { z } from "zod";
import { logAudit } from "@/lib/server/audit";
import { withTransaction } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { getSiteSettingsProfile } from "@/lib/server/site-settings";
import { handleApiError, jsonOk } from "@/lib/server/response";

const settingsSchema = z.object({
  site_name: z.string().trim().min(2).max(191),
  short_name: z.string().trim().min(2).max(100),
  tagline: z.string().trim().max(255).nullable(),
  currency_symbol: z.string().trim().min(1).max(10),
  timezone: z.string().trim().min(2).max(60),
  date_format: z.enum(["DD-MM-YYYY", "MM-DD-YYYY", "YYYY-MM-DD"]),
  logo_url: z.string().trim().max(500).nullable(),
  favicon_url: z.string().trim().max(500).nullable(),
  phone_number: z.string().trim().max(40).nullable(),
  address: z.string().trim().max(255).nullable(),
});

function cleanOptionalText(value: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

async function requireAdmin(request: NextRequest) {
  const user = await requireUserFromRequest(request);

  if (user.role !== "admin") {
    throw new ApiError(403, "Forbidden");
  }

  return user;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const settings = await getSiteSettingsProfile();
    return jsonOk({ settings });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAdmin(request);

    const body = await request.json().catch(() => {
      throw new ApiError(400, "Invalid JSON body");
    });

    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid site settings payload");
    }

    const payload = parsed.data;

    await withTransaction(async (conn) => {
      await conn.execute(
        `INSERT INTO site_settings (
          id,
          site_name,
          short_name,
          tagline,
          timezone,
          currency_symbol,
          date_format,
          support_phone,
          address,
          logo_url,
          favicon_url,
          created_at,
          updated_at
        ) VALUES (
          1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
        )
        ON DUPLICATE KEY UPDATE
          site_name = VALUES(site_name),
          short_name = VALUES(short_name),
          tagline = VALUES(tagline),
          timezone = VALUES(timezone),
          currency_symbol = VALUES(currency_symbol),
          date_format = VALUES(date_format),
          support_phone = VALUES(support_phone),
          address = VALUES(address),
          logo_url = VALUES(logo_url),
          favicon_url = VALUES(favicon_url),
          updated_at = NOW()`,
        [
          payload.site_name,
          payload.short_name,
          cleanOptionalText(payload.tagline),
          payload.timezone,
          payload.currency_symbol,
          payload.date_format,
          cleanOptionalText(payload.phone_number),
          cleanOptionalText(payload.address),
          cleanOptionalText(payload.logo_url),
          cleanOptionalText(payload.favicon_url),
        ],
      );

      await logAudit(
        {
          action: "Site Settings Updated",
          tableName: "site_settings",
          recordId: "1",
          detail: `Site settings updated by ${user.email}`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );
    });

    const settings = await getSiteSettingsProfile();

    return jsonOk({ settings });
  } catch (error) {
    return handleApiError(error);
  }
}