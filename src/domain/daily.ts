import {
  CASH_ID,
  BUDGET_MAX,
  MONEY_MAX,
  cents,
  yuan,
  totals,
  type Portfolio,
} from "./model";
import { distributeUnits } from "./input";
import { deviation } from "./planning";
import { localDate, validDate } from "./review";

export type AdjustmentKind = "recurring" | "append" | "trade" | "mixed";
export interface InvestmentRule {
  dailyLimit: number | null;
  buy: boolean;
  sell: boolean;
  note: string;
}
export interface DailySettings {
  budget: number;
  cadence: "weekdays" | "calendar";
  rules: Record<string, InvestmentRule>;
}
export interface AdjustmentRow {
  id: string;
  name: string;
  beforeDaily: number;
  daily: number;
  buy: number;
  sell: number;
  after: number;
}
export interface AdjustmentPlan {
  kind: AdjustmentKind;
  createdAt: string;
  startDate: string;
  reviewDate: string;
  days: number;
  extra: number;
  dailyBudget: number;
  cadence: DailySettings["cadence"];
  rows: AdjustmentRow[];
  unallocatedOnce: number;
  unallocatedDaily: number;
  maxAfter: number;
  inBand: boolean;
  firstInBand: number | null;
  signature: string;
}
export function dailySettings(p: Portfolio): DailySettings {
  return (
    p.dailySettings ?? {
      budget: yuan(Math.floor(cents(p.monthlyPlan?.budget ?? 0) / 21)),
      cadence: "weekdays",
      rules: {},
    }
  );
}
export function investmentRule(s: DailySettings, id: string): InvestmentRule {
  return Object.hasOwn(s.rules, id)
    ? s.rules[id]
    : { dailyLimit: null, buy: true, sell: true, note: "" };
}
export function dailyIssues(s: DailySettings): string[] {
  const money = (n: number, max: number) =>
    Number.isFinite(n) &&
    n >= 0 &&
    n <= max &&
    Math.abs(n * 100 - Math.round(n * 100)) < 0.0001;
  if (
    !money(s.budget, BUDGET_MAX) ||
    !["weekdays", "calendar"].includes(s.cadence)
  )
    return ["每日预算需为 0～100 万元，最多两位小数。"];
  if (
    Object.values(s.rules).some(
      (r) =>
        (r.dailyLimit !== null && !money(r.dailyLimit, MONEY_MAX)) ||
        typeof r.buy !== "boolean" ||
        typeof r.sell !== "boolean" ||
        typeof r.note !== "string" ||
        r.note.length > 120,
    )
  )
    return ["请检查限购金额与操作权限。"];
  return [];
}
export function dailyAllocation(p: Portfolio, s = dailySettings(p)) {
  if (dailyIssues(s).length) throw new Error(dailyIssues(s).join(" "));
  const amounts = distributeUnits(
    p.assets.map((a) => (a.id === CASH_ID ? 0 : a.target)),
    cents(s.budget),
  );
  const rows = p.assets
    .filter((a) => a.id !== CASH_ID)
    .map((a) => {
      const desired = amounts[p.assets.findIndex((b) => b.id === a.id)],
        r = investmentRule(s, a.id);
      const cap = r.buy
        ? Math.min(
            r.dailyLimit === null ? Infinity : cents(r.dailyLimit),
            a.monthlyLimit === null ? Infinity : cents(a.monthlyLimit),
          )
        : 0;
      return {
        id: a.id,
        name: a.name,
        target: a.target,
        desired: yuan(desired),
        amount: yuan(Math.min(desired, cap)),
        limited: desired > cap,
      };
    });
  return {
    rows,
    unallocated: yuan(
      cents(s.budget) - rows.reduce((sum, r) => sum + cents(r.amount), 0),
    ),
  };
}
export function planningSignature(p: Portfolio) {
  return JSON.stringify({
    assets: p.assets,
    settings: dailySettings(p),
    monthly: p.monthlyPlan,
    strategy: p.strategy,
    snapshot: p.snapshot,
  });
}
// A fixed schedule, rather than a different recommendation on every simulated day.
// Capped portions remain unallocated: never silently redirect restricted exposure.
function purchases(
  p: Portfolio,
  totalBudget: number,
  values: number[],
  caps: number[],
) {
  const total = values.reduce((sum, n) => sum + n, 0) + totalBudget;
  const gaps = p.assets.map((a, i) =>
    a.id === CASH_ID
      ? 0
      : Math.max(0, Math.floor((total * a.target) / 100 - values[i] + 1e-7)),
  );
  const amount = Math.min(
    totalBudget,
    gaps.reduce((sum, n) => sum + n, 0),
  );
  const desired = distributeUnits(gaps, amount);
  return desired.map((n, i) =>
    p.assets[i].id === CASH_ID ? 0 : Math.min(n, caps[i]),
  );
}
export function reviewAfterDays(
  start: string,
  count: number,
  cadence: DailySettings["cadence"],
) {
  const d = new Date(start + "T00:00:00Z");
  let seen = 0;
  while (seen < count) {
    if (cadence === "calendar" || ![0, 6].includes(d.getUTCDay())) seen++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}
export function buildAdjustment(
  p: Portfolio,
  s: DailySettings,
  kind: AdjustmentKind,
  extra: number,
  days: number,
  dailyBudget: number,
  startDate = localDate(),
): AdjustmentPlan {
  if (
    dailyIssues(s).length ||
    !validDate(startDate) ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 366 ||
    ![extra, dailyBudget].every(
      (n) =>
        Number.isFinite(n) &&
        n >= 0 &&
        n <= BUDGET_MAX &&
        Math.abs(n * 100 - Math.round(n * 100)) < 0.0001,
    )
  )
    throw new Error("请检查预算、开始日期与扣款次数（1～366 次）。");
  const recurring = kind === "recurring" || kind === "mixed";
  const trading = kind === "trade" || kind === "mixed";
  const added = kind === "recurring" ? 0 : cents(extra);
  const daily = recurring ? cents(dailyBudget) : 0;
  const cash = p.assets.findIndex((a) => a.id === CASH_ID);
  const current = p.assets.map((a) => cents(a.value));
  const rules = p.assets.map((a) => investmentRule(s, a.id));
  const total = cents(totals(p).invested) + added;
  const sells = p.assets.map((a, i) =>
    trading && a.id !== CASH_ID && rules[i].sell
      ? Math.max(0, current[i] - Math.round((total * a.target) / 100))
      : 0,
  );
  const values = current.map((n, i) => n - sells[i]);
  const proceeds = sells.reduce((sum, n) => sum + n, 0);
  const caps = p.assets.map((a, i) =>
    rules[i].buy
      ? Math.min(
          rules[i].dailyLimit === null ? Infinity : cents(rules[i].dailyLimit!),
          a.monthlyLimit === null ? Infinity : cents(a.monthlyLimit),
        )
      : 0,
  );
  // Available funds include external contributions and explicitly permitted sales only.
  const buys = purchases(p, added + proceeds, values, caps);
  const leftOnce = added + proceeds - buys.reduce((sum, n) => sum + n, 0);
  buys.forEach((n, i) => (values[i] += n));
  values[cash] += leftOnce;
  const recurringCaps = p.assets.map((a, i) =>
    rules[i].buy
      ? Math.min(
          rules[i].dailyLimit === null
            ? Infinity
            : Math.max(0, cents(rules[i].dailyLimit!) - buys[i]),
          a.monthlyLimit === null
            ? Infinity
            : Math.floor(Math.max(0, cents(a.monthlyLimit) - buys[i]) / days),
        )
      : 0,
  );
  // Reserve the first day's quota for the one-off purchase; this conservative fixed
  // amount can be entered once in Alipay and respects the combined same-day cap.
  const totalFuture = values.reduce((sum, n) => sum + n, 0) + daily * days;
  const gaps = p.assets.map((a, i) =>
    a.id === CASH_ID
      ? 0
      : Math.max(0, Math.floor((totalFuture * a.target) / 100 - values[i])),
  );
  const idealDaily = distributeUnits(
    gaps.some((n) => n > 0) ? gaps : p.assets.map((a) => a.target),
    daily,
  );
  const dailyBuys = idealDaily.map((n, i) =>
    recurring && p.assets[i].id !== CASH_ID ? Math.min(n, recurringCaps[i]) : 0,
  );
  const leftDaily = daily - dailyBuys.reduce((sum, n) => sum + n, 0);
  const projected = (count: number) => ({
    ...p,
    assets: p.assets.map((a, i) => ({
      ...a,
      value: yuan(
        values[i] + dailyBuys[i] * count + (i === cash ? leftDaily * count : 0),
      ),
    })),
  });
  const result = deviation(projected(recurring ? days : 0));
  let firstInBand: number | null = !deviation(projected(0)).breached ? 0 : null;
  if (recurring && firstInBand === null)
    for (let n = 1; n <= days; n++)
      if (!deviation(projected(n)).breached) {
        firstInBand = n;
        break;
      }
  const base = dailyAllocation(p, s);
  return {
    kind,
    createdAt: new Date().toISOString(),
    startDate,
    reviewDate: reviewAfterDays(startDate, recurring ? days : 1, s.cadence),
    days: recurring ? days : 0,
    extra: yuan(added),
    dailyBudget: yuan(daily),
    cadence: s.cadence,
    rows: p.assets
      .filter((a) => a.id !== CASH_ID)
      .map((a) => {
        const i = p.assets.findIndex((b) => b.id === a.id);
        return {
          id: a.id,
          name: a.name,
          beforeDaily: base.rows.find((r) => r.id === a.id)!.amount,
          daily: yuan(dailyBuys[i]),
          buy: yuan(buys[i]),
          sell: yuan(sells[i]),
          after: projected(recurring ? days : 0).assets[i].value,
        };
      }),
    unallocatedOnce: yuan(leftOnce),
    unallocatedDaily: yuan(leftDaily),
    maxAfter: result.max,
    inBand: !result.breached,
    firstInBand,
    signature: planningSignature(p),
  };
}
