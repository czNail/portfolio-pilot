import { CASH_ID, cents, yuan, newId, validate, type Portfolio } from "./model";
import { deviation, fullRebalance, executePlan, snapshotAge } from "./planning";
import { rebalance } from "./rebalance";
import { strategyConfirmed } from "./strategy";

export type ReviewMethod = "cashflow" | "trade";
export interface ReviewSnapshot {
  asOf: string;
  estimated: boolean;
  assets: { id: string; name: string; value: number; target: number }[];
  reserve: number;
}
export interface ReviewSession {
  id: string;
  startedAt: string;
  phase: "holdings" | "funding" | "result";
  method: ReviewMethod;
  before: ReviewSnapshot;
  finishing?: boolean;
}
export interface ReviewRecord {
  id: string;
  completedAt: string;
  outcome: "unchanged" | "estimated" | "actual";
  method: ReviewMethod;
  summary: string;
  rationale: string;
  budget: number;
  nextDate: string;
  before: ReviewSnapshot;
  after: ReviewSnapshot;
}
export interface ReviewState {
  intervalMonths: 3 | 6 | 12;
  nextDate: string;
  rationale: string;
  lastReviewedAt?: string;
  lastExportedAt?: string;
  active?: ReviewSession;
  records: ReviewRecord[];
}
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function addMonths(date: string, months: number) {
  if (!validDate(date)) throw new Error("复查日期无效。");
  const [y, m, d] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}
export function reviewState(p: Portfolio, today = localDate()): ReviewState {
  return (
    p.review ?? {
      intervalMonths: 6,
      nextDate: addMonths(p.strategy?.confirmedAt.slice(0, 10) ?? today, 6),
      rationale: "",
      records: [],
    }
  );
}
export function capture(p: Portfolio): ReviewSnapshot {
  return {
    asOf: p.snapshot?.asOf ?? localDate(),
    estimated: p.snapshot?.estimated ?? true,
    assets: p.assets.map(({ id, name, value, target }) => ({
      id,
      name,
      value,
      target,
    })),
    reserve: p.reserve,
  };
}
export function beginReview(p: Portfolio, now = new Date()): Portfolio {
  if (!strategyConfirmed(p)) throw new Error("请先确认长期配置。");
  if (p.review?.active) return p;
  return {
    ...p,
    budget: 0,
    source: "external",
    review: {
      ...reviewState(p, localDate(now)),
      active: {
        id: newId("review"),
        startedAt: now.toISOString(),
        phase: "holdings",
        method: "cashflow",
        before: capture(p),
      },
    },
  };
}
export function finishReview(
  p: Portfolio,
  outcome: ReviewRecord["outcome"],
  now = new Date(),
): Portfolio {
  const state = reviewState(p),
    active = state.active;
  if (!active || active.phase !== "result")
    throw new Error("请先完成持仓核对与资金确认。");
  if (!strategyConfirmed(p) || validate(p).length)
    throw new Error("请先修正配置或输入。");
  const age = snapshotAge(p.snapshot?.asOf, now);
  if (age === null || age < 0 || age > 30)
    throw new Error("请重新核对最新持仓后再结束复查。");
  if (outcome === "unchanged" && deviation(p).breached)
    throw new Error("持仓仍超出目标范围，请选择调整方案或暂存。");
  let next = p;
  if (outcome === "estimated") {
    const plan = rebalance(p);
    if (active.method === "cashflow") {
      if (p.budget <= 0 || plan.bought <= 0)
        throw new Error("没有可记录的买入，请调整资金或方案。");
      next = executePlan(p, plan, now.toISOString());
      next.snapshot = { asOf: localDate(now), estimated: true };
    } else {
      const rows = fullRebalance(p, plan);
      if (rows.some((r) => r.limited))
        throw new Error("买入超过剩余额度，请更新实际持仓后记录。");
      if (!rows.some((r) => r.change !== 0))
        throw new Error("当前取整下无需交易，请核对持仓或调整金额步长。");
      next = {
        ...p,
        budget: 0,
        reserve: plan.reserveAfter,
        snapshot: { asOf: localDate(now), estimated: true },
        assets: p.assets.map((a) => {
          const r = rows.find((r) => r.id === a.id)!;
          return {
            ...a,
            value: r.after,
            monthlyLimit:
              a.monthlyLimit === null
                ? null
                : yuan(
                    Math.max(
                      0,
                      cents(a.monthlyLimit) - cents(Math.max(0, r.change)),
                    ),
                  ),
          };
        }),
      };
    }
  }
  const nextIssues = validate(next);
  if (nextIssues.length) throw new Error(nextIssues.join(" "));
  const months = deviation(next).breached
    ? Math.min(state.intervalMonths, 3)
    : state.intervalMonths;
  const nextDate = addMonths(localDate(now), months);
  const record: ReviewRecord = {
    id: active.id,
    completedAt: now.toISOString(),
    outcome,
    method: active.method,
    summary:
      outcome === "unchanged"
        ? "偏差在范围内，继续原计划"
        : outcome === "actual"
          ? "已核对实际调整结果"
          : active.method === "cashflow"
            ? "已记录新增资金纠偏，持仓为估算"
            : "已记录买卖调整，持仓为估算",
    rationale: state.rationale,
    budget: outcome === "unchanged" ? 0 : p.budget,
    nextDate,
    before: active.before,
    after: capture(next),
  };
  return {
    ...next,
    budget: 0,
    review: {
      ...state,
      active: undefined,
      nextDate,
      lastReviewedAt: localDate(now),
      records: [record, ...state.records].slice(0, 30),
    },
  };
}
export function calendarText(date: string, now = new Date(), temporary = false) {
  if (!validDate(date)) throw new Error("复查日期无效。");
  const next = new Date(date + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Portfolio Pilot//Review//ZH-CN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:portfolio-review-${date}@cznail.github.io`,
    `DTSTAMP:${now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z")}`,
    `DTSTART;VALUE=DATE:${date.replaceAll("-", "")}`,
    `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replaceAll("-", "")}`,
    temporary ? "SUMMARY:复查临时定投设置" : "SUMMARY:资产配置复查",
    temporary ? "DESCRIPTION:核对最新持仓与支付宝定投设置，决定恢复原计划或继续调整。" : "DESCRIPTION:核对最新持仓后，再决定是否需要再平衡。",
    "URL:https://cznail.github.io/portfolio-pilot/",
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    "DESCRIPTION:明天复查资产配置",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
