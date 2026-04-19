import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { logAudit } from "@/lib/server/audit";
import { ApiError } from "@/lib/server/errors";
import { requireUserFromRequest } from "@/lib/server/require-user";
import { handleApiError, jsonOk } from "@/lib/server/response";

export const runtime = "nodejs";

const kindSchema = z.enum(["logo", "favicon"]);

const maxUploadSize = 2 * 1024 * 1024;

const allowedMimeByKind: Record<"logo" | "favicon", Set<string>> = {
  logo: new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/svg+xml",
  ]),
  favicon: new Set([
    "image/png",
    "image/svg+xml",
    "image/x-icon",
    "image/vnd.microsoft.icon",
  ]),
};

const allowedExtByKind: Record<"logo" | "favicon", Set<string>> = {
  logo: new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]),
  favicon: new Set([".png", ".svg", ".ico"]),
};

function extensionFromMime(mime: string) {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/svg+xml") return ".svg";
  if (mime === "image/x-icon" || mime === "image/vnd.microsoft.icon") return ".ico";
  return null;
}

async function requireAdmin(request: NextRequest) {
  const user = await requireUserFromRequest(request);

  if (user.role !== "admin") {
    throw new ApiError(403, "Forbidden");
  }

  return user;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin(request);

    const formData = await request.formData();
    const kindRaw = String(formData.get("kind") ?? "").trim();
    const kindParse = kindSchema.safeParse(kindRaw);
    if (!kindParse.success) {
      throw new ApiError(422, "Invalid asset kind");
    }

    const kind = kindParse.data;
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new ApiError(422, "Image file is required");
    }

    if (file.size <= 0) {
      throw new ApiError(422, "Uploaded file is empty");
    }

    if (file.size > maxUploadSize) {
      throw new ApiError(422, "File is too large. Max 2MB allowed");
    }

    const mime = (file.type || "").toLowerCase();
    const originalExt = path.extname(file.name || "").toLowerCase();
    const resolvedExt = extensionFromMime(mime) ?? originalExt;

    const mimeAllowed = allowedMimeByKind[kind].has(mime);
    const extAllowed = allowedExtByKind[kind].has(resolvedExt);
    if (!mimeAllowed && !extAllowed) {
      throw new ApiError(422, "Unsupported image format for this upload");
    }

    const safeExt = extAllowed ? resolvedExt : extensionFromMime(mime);
    if (!safeExt) {
      throw new ApiError(422, "Could not determine file extension");
    }

    const fileName = `${kind}-${Date.now()}-${randomUUID().slice(0, 8)}${safeExt}`;
    const relativeDir = path.join("uploads", "site-settings");
    const absoluteDir = path.join(process.cwd(), "public", relativeDir);
    const absolutePath = path.join(absoluteDir, fileName);

    await mkdir(absoluteDir, { recursive: true });

    const bytes = await file.arrayBuffer();
    await writeFile(absolutePath, Buffer.from(bytes));

    const url = `/${relativeDir.replace(/\\/g, "/")}/${fileName}`;

    await logAudit(
      {
        action: "Site Asset Uploaded",
        tableName: "site_settings",
        recordId: "1",
        detail: `${kind} uploaded by ${user.email}: ${url}`,
        userId: user.id,
        userEmail: user.email,
      },
      request,
    );

    return jsonOk({ kind, url });
  } catch (error) {
    return handleApiError(error);
  }
}