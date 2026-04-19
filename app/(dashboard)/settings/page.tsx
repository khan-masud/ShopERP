"use client";

import Image from "next/image";
import { useMemo, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { formatDateTime } from "@/lib/utils";

type DateFormat = "DD-MM-YYYY" | "MM-DD-YYYY" | "YYYY-MM-DD";
type AssetKind = "logo" | "favicon";

type SiteSettings = {
  site_name: string;
  short_name: string;
  tagline: string;
  timezone: string;
  currency_symbol: string;
  date_format: DateFormat;
  phone_number: string | null;
  address: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  updated_at: string | null;
};

type SettingsResponse = {
  settings: SiteSettings;
};

type ApiSuccess<T> = {
  success: true;
  data: T;
};

type ApiErrorPayload = {
  success: false;
  message?: string;
};

const defaultSettings: SiteSettings = {
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

async function fetchSettings() {
  const res = await fetch("/api/settings", {
    cache: "no-store",
  });

  const payload = (await res.json()) as ApiSuccess<SettingsResponse> | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to load shop settings");
  }

  return payload.data;
}

async function uploadAsset(kind: AssetKind, file: File) {
  const formData = new FormData();
  formData.append("kind", kind);
  formData.append("file", file);

  const res = await fetch("/api/settings/upload", {
    method: "POST",
    body: formData,
  });

  const payload = (await res.json()) as ApiSuccess<{ kind: AssetKind; url: string }> | ApiErrorPayload;

  if (!res.ok || !payload.success) {
    throw new Error((payload as ApiErrorPayload).message ?? "Failed to upload file");
  }

  return payload.data.url;
}

function toInputValue(value: string | null) {
  return value ?? "";
}

export default function ShopSettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["site-settings"],
    queryFn: fetchSettings,
  });

  const [draft, setDraft] = useState<SiteSettings | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingFavicon, setIsUploadingFavicon] = useState(false);

  const savedSettings = data?.settings ?? defaultSettings;
  const currentSettings = draft ?? savedSettings;

  const hasChanges = useMemo(() => {
    return JSON.stringify(currentSettings) !== JSON.stringify(savedSettings);
  }, [currentSettings, savedSettings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(currentSettings),
      });

      const payload = (await res.json()) as ApiSuccess<SettingsResponse> | ApiErrorPayload;

      if (!res.ok || !payload.success) {
        throw new Error((payload as ApiErrorPayload).message ?? "Failed to update shop settings");
      }

      return payload.data;
    },
    onSuccess: async (updatedData) => {
      queryClient.setQueryData(["site-settings"], updatedData);
      setDraft(updatedData.settings);
      toast.success("Shop settings updated");
      await queryClient.invalidateQueries({ queryKey: ["site-settings"] });
      router.refresh();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function setField<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
    setDraft((prev) => ({
      ...(prev ?? savedSettings),
      [key]: value,
    }));
  }

  async function handleAssetUpload(kind: AssetKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (kind === "logo") {
      setIsUploadingLogo(true);
    } else {
      setIsUploadingFavicon(true);
    }

    try {
      const uploadedUrl = await uploadAsset(kind, file);

      if (kind === "logo") {
        setField("logo_url", uploadedUrl);
      } else {
        setField("favicon_url", uploadedUrl);
      }

      toast.success(`${kind === "logo" ? "Logo" : "Favicon"} uploaded`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      if (kind === "logo") {
        setIsUploadingLogo(false);
      } else {
        setIsUploadingFavicon(false);
      }
    }
  }

  return (
    <div className="space-y-5">
      {isLoading ? <Card className="p-5 text-sm text-slate-500">Loading shop settings...</Card> : null}

      {isError ? (
        <Card className="p-5 text-sm text-red-600">
          Failed to load shop settings. Admin access is required.
        </Card>
      ) : null}

      {!isLoading && !isError ? (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Shop Settings</h2>
                <p className="text-sm text-slate-500">
                  Configure your core shop identity and default display settings.
                </p>
              </div>
              <div className="text-xs text-slate-500">
                Last updated: {currentSettings.updated_at ? formatDateTime(currentSettings.updated_at) : "-"}
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Shop Name"
                value={currentSettings.site_name}
                onChange={(event) => setField("site_name", event.target.value)}
                placeholder="ShopERP"
              />

              <Input
                label="Short Name"
                value={currentSettings.short_name}
                onChange={(event) => setField("short_name", event.target.value)}
                placeholder="ShopERP"
              />

              <Input
                label="Timezone"
                value={currentSettings.timezone}
                onChange={(event) => setField("timezone", event.target.value)}
                placeholder="Asia/Dhaka"
              />

              <Input
                label="Currency Symbol"
                value={currentSettings.currency_symbol}
                onChange={(event) => setField("currency_symbol", event.target.value)}
                placeholder="৳"
                maxLength={10}
              />

              <label className="flex w-full flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">Date Format</span>
                <select
                  value={currentSettings.date_format}
                  onChange={(event) => setField("date_format", event.target.value as DateFormat)}
                  className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="DD-MM-YYYY">DD-MM-YYYY</option>
                  <option value="MM-DD-YYYY">MM-DD-YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                </select>
              </label>

              <Input
                label="Phone Number"
                value={toInputValue(currentSettings.phone_number)}
                onChange={(event) => setField("phone_number", event.target.value || null)}
                placeholder="+8801XXXXXXXXX"
              />

              <Input
                label="Address"
                value={toInputValue(currentSettings.address)}
                onChange={(event) => setField("address", event.target.value || null)}
                placeholder="Shop address"
              />
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-medium text-slate-600">Logo Upload</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={(event) => handleAssetUpload("logo", event)}
                    disabled={isUploadingLogo}
                    className="block w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-blue-700 hover:file:bg-blue-100"
                  />

                  <span className="text-xs text-slate-500">
                    {isUploadingLogo ? "Uploading logo..." : "PNG, JPG, WEBP, SVG (max 2MB)"}
                  </span>

                  {currentSettings.logo_url ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setField("logo_url", null)}
                      disabled={isUploadingLogo}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>

                <p className="mt-2 break-all text-xs text-slate-500">{currentSettings.logo_url ?? "No logo uploaded"}</p>

                {currentSettings.logo_url ? (
                  <div className="mt-3 rounded border border-slate-200 bg-white p-2">
                    <Image
                      src={currentSettings.logo_url}
                      alt="Shop logo preview"
                      width={160}
                      height={64}
                      className="h-12 w-auto object-contain"
                      unoptimized
                    />
                  </div>
                ) : null}
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-medium text-slate-600">Favicon Upload</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="file"
                    accept="image/png,image/svg+xml,image/x-icon,.ico"
                    onChange={(event) => handleAssetUpload("favicon", event)}
                    disabled={isUploadingFavicon}
                    className="block w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-blue-700 hover:file:bg-blue-100"
                  />

                  <span className="text-xs text-slate-500">
                    {isUploadingFavicon ? "Uploading favicon..." : "PNG, SVG, ICO (max 2MB)"}
                  </span>

                  {currentSettings.favicon_url ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setField("favicon_url", null)}
                      disabled={isUploadingFavicon}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>

                <p className="mt-2 break-all text-xs text-slate-500">{currentSettings.favicon_url ?? "No favicon uploaded"}</p>

                {currentSettings.favicon_url ? (
                  <div className="mt-3 rounded border border-slate-200 bg-white p-2">
                    <Image
                      src={currentSettings.favicon_url}
                      alt="Favicon preview"
                      width={32}
                      height={32}
                      className="h-8 w-8 object-contain"
                      unoptimized
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <label className="mt-4 flex w-full flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">Tagline</span>
              <textarea
                value={currentSettings.tagline}
                onChange={(event) => setField("tagline", event.target.value)}
                rows={2}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Super Shop Control Panel"
              />
            </label>
          </Card>

          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setDraft(savedSettings)}
                disabled={!hasChanges || saveMutation.isPending}
              >
                Reset Unsaved
              </Button>
              <Button
                variant="secondary"
                onClick={() => setDraft(defaultSettings)}
                disabled={saveMutation.isPending}
              >
                Use Default
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!hasChanges || saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
