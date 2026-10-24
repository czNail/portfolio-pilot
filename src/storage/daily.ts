import {
  dailyIssues,
  type DailySettings,
  type AdjustmentPlan,
} from "../domain/daily";
import { validDate } from "../domain/review";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const money = (v: unknown) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= 0 &&
  v <= 1e12 &&
  Math.abs(v * 100 - Math.round(v * 100)) < 0.0001;
export function readDailySettings(v: unknown): DailySettings {
  if (
    !object(v) ||
    !object(v.rules) ||
    Object.keys(v.rules).length > 16 ||
    Object.entries(v.rules).some(
      ([id, r]) =>
        !id ||
        id.length > 200 ||
        !object(r) ||
        (r.dailyLimit !== null && !money(r.dailyLimit)) ||
        typeof r.buy !== "boolean" ||
        typeof r.sell !== "boolean" ||
        typeof r.note !== "string" ||
        r.note.length > 120,
    )
  )
    throw new Error("每日定投设置格式不正确。");
  const s = v as unknown as DailySettings;
  if (dailyIssues(s).length) throw new Error(dailyIssues(s).join(" "));
  return structuredClone(s);
}
export function readAdjustment(v: unknown): AdjustmentPlan {
  if (
    !object(v) ||
    !["recurring", "append", "trade", "mixed"].includes(String(v.kind)) ||
    typeof v.createdAt !== "string" ||
    !Number.isFinite(Date.parse(v.createdAt)) ||
    !validDate(v.startDate) ||
    !validDate(v.reviewDate) ||
    v.reviewDate < v.startDate ||
    !Number.isInteger(v.days) ||
    Number(v.days) < 0 ||
    Number(v.days) > 366 ||
    !money(v.extra) ||
    !money(v.dailyBudget) ||
    !["weekdays", "calendar"].includes(String(v.cadence)) ||
    !money(v.unallocatedOnce) ||
    !money(v.unallocatedDaily) ||
    typeof v.maxAfter !== "number" ||
    !Number.isFinite(v.maxAfter) ||
    v.maxAfter < 0 ||
    v.maxAfter > 100 ||
    typeof v.inBand !== "boolean" ||
    (v.firstInBand !== null &&
      (!Number.isInteger(v.firstInBand) ||
        Number(v.firstInBand) < 0 ||
        Number(v.firstInBand) > Number(v.days))) ||
    typeof v.signature !== "string" ||
    v.signature.length > 20000 ||
    !Array.isArray(v.rows) ||
    v.rows.length > 16 ||
    v.rows.some(
      (r) =>
        !object(r) ||
        typeof r.id !== "string" ||
        r.id.length > 200 ||
        typeof r.name !== "string" ||
        r.name.length > 40 ||
        !["beforeDaily", "daily", "buy", "sell", "after"].every((key) =>
          money(r[key]),
        ),
    ) ||
    new Set(v.rows.map((r) => r.id)).size !== v.rows.length
  )
    throw new Error("临时调整计划格式不正确。");
  return structuredClone(v) as unknown as AdjustmentPlan;
}
