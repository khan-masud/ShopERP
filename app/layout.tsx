import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppProviders } from "@/components/providers/AppProviders";
import { getSiteSettingsProfile } from "@/lib/server/site-settings";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function iconTypeByPath(pathname: string) {
  const lower = pathname.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/x-icon";
}

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettingsProfile();
  const iconPath = settings.favicon_url || "/favicon.ico";
  const iconVersion = settings.updated_at ? new Date(settings.updated_at).getTime() : 1;
  const iconWithVersion = `${iconPath}${iconPath.includes("?") ? "&" : "?"}v=${iconVersion}`;
  const iconType = iconTypeByPath(iconPath);

  return {
    title: {
      default: settings.site_name,
      template: `%s | ${settings.site_name}`,
    },
    description: settings.tagline || "Security-first Super Shop ERP for Bangladesh retail operations.",
    icons: {
      icon: {
        url: iconWithVersion,
        type: iconType,
      },
      shortcut: {
        url: iconWithVersion,
        type: iconType,
      },
      apple: settings.logo_url || iconPath,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getSiteSettingsProfile();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full flex flex-col bg-slate-100 text-slate-900"
        data-shoperp-site-name={settings.site_name}
        data-shoperp-short-name={settings.short_name}
        data-shoperp-tagline={settings.tagline}
        data-shoperp-timezone={settings.timezone}
        data-shoperp-currency-symbol={settings.currency_symbol}
        data-shoperp-date-format={settings.date_format}
        data-shoperp-phone-number={settings.phone_number ?? undefined}
        data-shoperp-address={settings.address ?? undefined}
        data-shoperp-logo-url={settings.logo_url ?? undefined}
        data-shoperp-favicon-url={settings.favicon_url ?? undefined}
      >
        <div className="flex min-h-full flex-col">
          <AppProviders>{children}</AppProviders>
        </div>
      </body>
    </html>
  );
}
