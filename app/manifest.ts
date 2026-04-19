import type { MetadataRoute } from "next";
import { getSiteSettingsProfile } from "@/lib/server/site-settings";

export const dynamic = "force-dynamic";

function iconTypeByPath(pathname: string) {
  const lower = pathname.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/x-icon";
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getSiteSettingsProfile();
  const iconVersion = settings.updated_at ? new Date(settings.updated_at).getTime() : 1;
  const iconPath = settings.favicon_url || "/favicon.ico";
  const iconWithVersion = `${iconPath}${iconPath.includes("?") ? "&" : "?"}v=${iconVersion}`;

  return {
    name: settings.site_name,
    short_name: settings.short_name,
    description: settings.tagline || "Security-first Super Shop ERP for Bangladesh retail operations.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f1f5f9",
    theme_color: "#0f172a",
    icons: [
      {
        src: iconWithVersion,
        sizes: "48x48",
        type: iconTypeByPath(iconPath),
      },
    ],
  };
}
