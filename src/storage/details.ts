import {
  MONEY_MAX,
  type Portfolio,
  type ExecutionRecord,
} from "../domain/model";
import { RULE_VERSION, validProfile } from "../domain/strategy";
import { readReview } from "./review";
import { readDailySettings, readAdjustment } from "./daily";

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const date = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const money = (v: unknown) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= 0 &&
  v <= MONEY_MAX &&
  Math.abs(v * 100 - Math.round(v * 100)) < 0.0001;
export function readDetails(x: Record<string, unknown>): Partial<Portfolio> {
  const result: Partial<Portfolio> = {};
  if (x.dailySettings !== undefined) result.dailySettings = readDailySettings(x.dailySettings);
  if (x.adjustment !== undefined) result.adjustment = readAdjustment(x.adjustment);
  if (x.review !== undefined) result.review = readReview(x.review);
  if (x.monthlyPlan !== undefined) {
    const m = x.monthlyPlan;
    if (
      !object(m) ||
      !money(m.budget) ||
      !Array.isArray(m.assetIds) ||
      m.assetIds.length > 16 ||
      m.assetIds.some((id) => typeof id !== "string" || id.length > 200)
    )
      throw new Error("定投计划格式不正确。");
    result.monthlyPlan = {
      budget: m.budget as number,
      assetIds: m.assetIds as string[],
    };
  }
  if (x.riskProfile !== undefined) {
    if (!validProfile(x.riskProfile)) throw new Error("风险评估格式不正确。");
    result.riskProfile = x.riskProfile;
  }
  if (x.strategy !== undefined) {
    const s = x.strategy;
    if (
      !object(s) ||
      s.ruleVersion !== RULE_VERSION ||
      !Number.isSafeInteger(s.revision) ||
      Number(s.revision) < 1 ||
      typeof s.label !== "string" ||
      s.label.length > 40 ||
      !date(s.confirmedAt) ||
      !object(s.targets) ||
      Object.keys(s.targets).length > 16 ||
      Object.values(s.targets).some(
        (v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100,
      ) ||
      typeof s.band !== "number" ||
      !Number.isFinite(s.band) ||
      s.band < 1 ||
      s.band > 15 ||
      typeof s.relativeBand !== "number" ||
      !Number.isFinite(s.relativeBand) ||
      s.relativeBand < 1 ||
      s.relativeBand > 100 ||
      typeof s.custom !== "boolean"
    )
      throw new Error("长期策略格式不正确。");
    result.strategy = s as unknown as Portfolio["strategy"];
  }
  if (x.snapshot !== undefined) {
    const s = x.snapshot;
    if (
      !object(s) ||
      typeof s.asOf !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(s.asOf) ||
      !date(s.asOf) ||
      new Date(s.asOf).toISOString().slice(0, 10) !== s.asOf ||
      typeof s.estimated !== "boolean"
    )
      throw new Error("持仓日期格式不正确。");
    result.snapshot = { asOf: s.asOf, estimated: s.estimated };
  }
  if (x.history !== undefined) {
    if (!Array.isArray(x.history) || x.history.length > 20)
      throw new Error("执行记录格式不正确。");
    for (const r of x.history) {
      if (
        !object(r) ||
        typeof r.id !== "string" ||
        r.id.length > 100 ||
        !date(r.executedAt) ||
        !money(r.budget) ||
        !money(r.keptCash) ||
        !["external", "cash", "reserve"].includes(String(r.source)) ||
        !Array.isArray(r.buys) ||
        r.buys.length > 16 ||
        r.buys.some(
          (b) =>
            !object(b) ||
            typeof b.id !== "string" ||
            b.id.length > 200 ||
            typeof b.name !== "string" ||
            b.name.length > 40 ||
            !money(b.amount),
        )
      )
        throw new Error("执行记录格式不正确。");
    }
    result.history = x.history as ExecutionRecord[];
  }
  return result;
}
