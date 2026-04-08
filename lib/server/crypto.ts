import { createHash } from "crypto";

export function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
