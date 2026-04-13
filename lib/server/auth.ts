import bcrypt from "bcryptjs";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { type NextResponse } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  type UserRole,
} from "@/lib/server/constants";
import { appEnv, assertStrongJwtSecrets, isProduction } from "@/lib/server/env";

export interface TokenPayload extends JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  sessionId?: number;
}

const ACCESS_TTL_SECONDS = ttlToSeconds(appEnv.ACCESS_TOKEN_TTL, 30 * 60);
const REFRESH_TTL_SECONDS = ttlToSeconds(appEnv.REFRESH_TOKEN_TTL, 7 * 24 * 60 * 60);

function ttlToSeconds(ttl: string, fallback: number) {
  const match = ttl.match(/^(\d+)([smhd])$/i);
  if (!match) {
    return fallback;
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (unit === "s") return value;
  if (unit === "m") return value * 60;
  if (unit === "h") return value * 60 * 60;
  if (unit === "d") return value * 24 * 60 * 60;

  return fallback;
}

export function signAccessToken(payload: TokenPayload) {
  assertStrongJwtSecrets();
  return jwt.sign(payload, appEnv.JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_TTL_SECONDS,
  });
}

export function getAccessTokenTtlSeconds() {
  return ACCESS_TTL_SECONDS;
}

export function getRefreshTokenTtlSeconds() {
  return REFRESH_TTL_SECONDS;
}

export function getRefreshTokenExpiryDate(fromDate = new Date()) {
  return new Date(fromDate.getTime() + REFRESH_TTL_SECONDS * 1000);
}

export function signRefreshToken(payload: TokenPayload) {
  assertStrongJwtSecrets();
  return jwt.sign(payload, appEnv.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string) {
  try {
    assertStrongJwtSecrets();
    return jwt.verify(token, appEnv.JWT_ACCESS_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string) {
  try {
    assertStrongJwtSecrets();
    return jwt.verify(token, appEnv.JWT_REFRESH_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function setAuthCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string,
) {
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: accessToken,
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/",
    maxAge: ACCESS_TTL_SECONDS,
  });

  response.cookies.set({
    name: REFRESH_COOKIE_NAME,
    value: refreshToken,
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/",
    maxAge: REFRESH_TTL_SECONDS,
  });
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: "",
    maxAge: 0,
    path: "/",
  });

  response.cookies.set({
    name: REFRESH_COOKIE_NAME,
    value: "",
    maxAge: 0,
    path: "/",
  });
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
