import { MONEY_MAX } from "../domain/model";
import {
  validDate,
  type ReviewState,
  type ReviewSnapshot,
} from "../domain/review";

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number) =>
  typeof v === "string" && v.length <= max;
const timestamp = (v: unknown) =>
  typeof v === "string" && v.length < 40 && Number.isFinite(Date.parse(v));
const money = (v: unknown) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= 0 &&
  v <= MONEY_MAX &&
  Math.abs(v * 100 - Math.round(v * 100)) < 0.0001;
function snapshot(v: unknown): v is ReviewSnapshot {
  if (
    !object(v) ||
    !validDate(v.asOf) ||
    typeof v.estimated !== "boolean" ||
    !money(v.reserve) ||
    !Array.isArray(v.assets) ||
    v.assets.length < 2 ||
    v.assets.length > 16
  )
    return false;
  return (
    v.assets.every(
      (a) =>
        object(a) &&
        text(a.id, 200) &&
        !!a.id &&
        text(a.name, 40) &&
        !!a.name &&
        money(a.value) &&
        typeof a.target === "number" &&
        Number.isFinite(a.target) &&
        a.target >= 0 &&
        a.target <= 100,
    ) &&
    new Set(v.assets.map((a) => a.id)).size === v.assets.length &&
    Math.abs(v.assets.reduce((s, a) => s + a.target, 0) - 100) < 0.0001
  );
}
export function readReview(v: unknown): ReviewState | undefined {
  if (v === undefined) return undefined; // Existing v4 data needs no destructive migration.
  if (
    !object(v) ||
    ![3, 6, 12].includes(Number(v.intervalMonths)) ||
    typeof v.intervalMonths !== "number" ||
    !validDate(v.nextDate) ||
    !text(v.rationale, 1000) ||
    (v.lastReviewedAt !== undefined && !validDate(v.lastReviewedAt)) ||
    (v.lastExportedAt !== undefined && !timestamp(v.lastExportedAt)) ||
    !Array.isArray(v.records) ||
    v.records.length > 30
  )
    throw new Error("复查安排格式不正确。");
  if (v.active !== undefined) {
    const a = v.active;
    if (
      !object(a) ||
      !text(a.id, 100) ||
      !a.id ||
      !timestamp(a.startedAt) ||
      !["holdings", "funding", "result"].includes(String(a.phase)) ||
      !["cashflow", "trade"].includes(String(a.method)) ||
      !snapshot(a.before) ||
      (a.finishing !== undefined && typeof a.finishing !== "boolean")
    )
      throw new Error("待完成复查格式不正确。");
  }
  for (const r of v.records) {
    if (
      !object(r) ||
      !text(r.id, 100) ||
      !r.id ||
      !timestamp(r.completedAt) ||
      !["unchanged", "estimated", "actual"].includes(String(r.outcome)) ||
      !["cashflow", "trade"].includes(String(r.method)) ||
      !text(r.summary, 200) ||
      !text(r.rationale, 1000) ||
      !money(r.budget) ||
      !validDate(r.nextDate) ||
      !snapshot(r.before) ||
      !snapshot(r.after)
    )
      throw new Error("复查记录格式不正确。");
  }
  return structuredClone(v) as unknown as ReviewState;
}
