import type { RowDataPacket } from "mysql2/promise";
import { dbQuery } from "@/lib/server/db";

export type SiteDateFormat = "DD-MM-YYYY" | "MM-DD-YYYY" | "YYYY-MM-DD";

interface SiteSettingsRow extends RowDataPacket {
  site_name: string;
  short_name: string;
  tagline: string | null;
  timezone: string;
  currency_symbol: string;
  date_format: SiteDateFormat;
  phone_number: string | null;
  address: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  updated_at: Date | null;
}

export type SiteSettingsProfile = {
  site_name: string;
  short_name: string;
  tagline: string;
  timezone: string;
  currency_symbol: string;
  date_format: SiteDateFormat;
  phone_number: string | null;
  address: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  updated_at: Date | null;
}

export type SiteBranding = {
  site_name: string;
  short_name: string;
  tagline: string;
};

const fallbackSettings: SiteSettingsProfile = {
  site_name: "ShopERP",
  short_name: "ShopERP",
  tagline: "Super Shop Control Panel",
  timezone: "Asia/Dhaka",
  currency_symbol: "৳",
  date_format: "DD-MM-YYYY",
  phone_number: null,
  address: null,
  logo_url: null,
  favicon_url: null,
  updated_at: null,
};

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function getSiteSettingsProfile(): Promise<SiteSettingsProfile> {
  const rows = await dbQuery<SiteSettingsRow[]>(
    `SELECT
       site_name,
       short_name,
       tagline,
       timezone,
       currency_symbol,
       date_format,
       support_phone AS phone_number,
       address,
       logo_url,
       favicon_url,
       updated_at
     FROM site_settings
     WHERE id = 1
     LIMIT 1`,
  );

  const row = rows[0];

  if (!row) {
    return fallbackSettings;
  }

  return {
    site_name: normalizeText(row.site_name) ?? fallbackSettings.site_name,
    short_name: normalizeText(row.short_name) ?? fallbackSettings.short_name,
    tagline: normalizeText(row.tagline) ?? fallbackSettings.tagline,
    timezone: normalizeText(row.timezone) ?? fallbackSettings.timezone,
    currency_symbol: normalizeText(row.currency_symbol) ?? fallbackSettings.currency_symbol,
    date_format: row.date_format ?? fallbackSettings.date_format,
    phone_number: normalizeText(row.phone_number),
    address: normalizeText(row.address),
    logo_url: normalizeText(row.logo_url),
    favicon_url: normalizeText(row.favicon_url),
    updated_at: row.updated_at ?? null,
  };
}

export async function getSiteBranding(): Promise<SiteBranding> {
  const settings = await getSiteSettingsProfile();

  return {
    site_name: settings.site_name,
    short_name: settings.short_name,
    tagline: settings.tagline,
  };
}