export type SiteDateFormat = "DD-MM-YYYY" | "MM-DD-YYYY" | "YYYY-MM-DD";

type RuntimeSiteSettings = {
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
};

const defaultRuntimeSiteSettings: RuntimeSiteSettings = {
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
};

function normalizeRuntimeSiteSettings(value: unknown): RuntimeSiteSettings {
  if (!value || typeof value !== "object") {
    return defaultRuntimeSiteSettings;
  }

  const candidate = value as Partial<RuntimeSiteSettings>;

  return {
    site_name: (candidate.site_name || defaultRuntimeSiteSettings.site_name).trim(),
    short_name: (candidate.short_name || defaultRuntimeSiteSettings.short_name).trim(),
    tagline: (candidate.tagline || defaultRuntimeSiteSettings.tagline).trim(),
    timezone: (candidate.timezone || defaultRuntimeSiteSettings.timezone).trim(),
    currency_symbol: (candidate.currency_symbol || defaultRuntimeSiteSettings.currency_symbol).trim(),
    date_format:
      candidate.date_format === "MM-DD-YYYY" || candidate.date_format === "YYYY-MM-DD"
        ? candidate.date_format
        : "DD-MM-YYYY",
    phone_number: candidate.phone_number?.trim() || null,
    address: candidate.address?.trim() || null,
    logo_url: candidate.logo_url?.trim() || null,
    favicon_url: candidate.favicon_url?.trim() || null,
  };
}

function readRuntimeSettingsFromDataset() {
  if (typeof document === "undefined") {
    return null;
  }

  const dataset = document.body?.dataset;
  if (!dataset) {
    return null;
  }

  const siteName = dataset.shoperpSiteName?.trim();
  if (!siteName) {
    return null;
  }

  return {
    site_name: siteName,
    short_name: dataset.shoperpShortName,
    tagline: dataset.shoperpTagline,
    timezone: dataset.shoperpTimezone,
    currency_symbol: dataset.shoperpCurrencySymbol,
    date_format: dataset.shoperpDateFormat as SiteDateFormat | undefined,
    phone_number: dataset.shoperpPhoneNumber ?? null,
    address: dataset.shoperpAddress ?? null,
    logo_url: dataset.shoperpLogoUrl ?? null,
    favicon_url: dataset.shoperpFaviconUrl ?? null,
  } satisfies Partial<RuntimeSiteSettings>;
}

export function getRuntimeSiteSettings(): RuntimeSiteSettings {
  const fromDataset = readRuntimeSettingsFromDataset();
  if (fromDataset) {
    return normalizeRuntimeSiteSettings(fromDataset);
  }

  return normalizeRuntimeSiteSettings(globalThis.__SHOPERP_SITE_SETTINGS);
}

function toDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function formatByPattern(day: string, month: string, year: string, format: SiteDateFormat) {
  if (format === "MM-DD-YYYY") {
    return `${month}-${day}-${year}`;
  }

  if (format === "YYYY-MM-DD") {
    return `${year}-${month}-${day}`;
  }

  return `${day}-${month}-${year}`;
}

function getDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    day: bag.day ?? "00",
    month: bag.month ?? "00",
    year: bag.year ?? "0000",
    hour: bag.hour ?? "00",
    minute: bag.minute ?? "00",
  };
}

export function formatTaka(value: number | string) {
  const numeric = typeof value === "string" ? Number(value) : value;
  const settings = getRuntimeSiteSettings();

  return `${settings.currency_symbol}${new Intl.NumberFormat("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(numeric) ? numeric : 0)}`;
}

export function formatDate(value: string | Date) {
  const date = toDate(value);
  if (!date) {
    return "-";
  }

  const settings = getRuntimeSiteSettings();
  const parts = getDateParts(date, settings.timezone);

  return formatByPattern(parts.day, parts.month, parts.year, settings.date_format);
}

export function formatDateTime(value: string | Date) {
  const date = toDate(value);
  if (!date) {
    return "-";
  }

  const settings = getRuntimeSiteSettings();
  const parts = getDateParts(date, settings.timezone);
  const dateText = formatByPattern(parts.day, parts.month, parts.year, settings.date_format);

  return `${dateText} ${parts.hour}:${parts.minute}`;
}

declare global {
  var __SHOPERP_SITE_SETTINGS: Partial<RuntimeSiteSettings> | undefined;
}
