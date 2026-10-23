import type { MonthlyPlan } from "./monthly";
import type { AllocationStrategy, RiskProfile } from "./strategy";
import type { ReviewState } from "./review";

export interface Asset {
  id: string;
  name: string;
  value: number;
  target: number;
  shock: number;
  monthlyLimit: number | null;
}
export type FundingSource = "external" | "cash" | "reserve";
export interface Snapshot {
  asOf: string;
  estimated: boolean;
}
export interface ExecutionRecord {
  id: string;
  executedAt: string;
  budget: number;
  source: FundingSource;
  buys: { id: string; name: string; amount: number }[];
  keptCash: number;
}
export interface Portfolio {
  version: 4;
  demo: boolean;
  budget: number;
  source: FundingSource;
  rounding: 1 | 10 | 100;
  reserve: number;
  reserveShock: number;
  assets: Asset[];
  monthlyPlan?: MonthlyPlan;
  strategy?: AllocationStrategy;
  riskProfile?: RiskProfile;
  snapshot?: Snapshot;
  history?: ExecutionRecord[];
  review?: ReviewState;
}
export const CASH_ID = "cash";
export const MONEY_MAX = 1_000_000_000_000;
export const BUDGET_MAX = 1_000_000;
export const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);
export const yuan = (n: number) => n / 100;
export function newId(prefix = "asset") {
  return `${prefix}-${crypto.randomUUID()}`;
}
export function emptyPortfolio(): Portfolio {
  return {
    version: 4,
    demo: false,
    budget: 0,
    source: "external",
    rounding: 10,
    reserve: 0,
    reserveShock: 0,
    assets: [
      {
        id: "us",
        name: "美股",
        value: 0,
        target: 0,
        shock: 60,
        monthlyLimit: null,
      },
      {
        id: "cn",
        name: "A 股",
        value: 0,
        target: 0,
        shock: 60,
        monthlyLimit: null,
      },
      {
        id: "gold",
        name: "黄金",
        value: 0,
        target: 0,
        shock: 20,
        monthlyLimit: null,
      },
      {
        id: "bonds",
        name: "债券",
        value: 0,
        target: 0,
        shock: 10,
        monthlyLimit: null,
      },
      {
        id: CASH_ID,
        name: "待投资余额",
        value: 0,
        target: 100,
        shock: 0,
        monthlyLimit: null,
      },
    ],
  };
}
export function demoPortfolio(): Portfolio {
  const p = emptyPortfolio();
  p.demo = true;
  p.budget = 4000;
  p.assets = p.assets.map((a, i) => ({
    ...a,
    value: [50000, 15000, 10000, 25000, 0][i],
    target: [35, 20, 10, 30, 5][i],
  }));
  return p;
}
export function totals(p: Portfolio) {
  const invested = yuan(p.assets.reduce((s, a) => s + cents(a.value), 0));
  return { invested, total: invested + p.reserve };
}
export function validate(
  p: Portfolio,
  { forPlan = false }: { forPlan?: boolean } = {},
): string[] {
  const issues: string[] = [];
  const money = (n: number, label: string, max = MONEY_MAX) => {
    if (
      !Number.isFinite(n) ||
      n < 0 ||
      n > max ||
      Math.abs(n * 100 - Math.round(n * 100)) > 0.0001
    )
      issues.push(`${label}需为非负金额，最多两位小数。`);
  };
  money(p.budget, "本次预算", BUDGET_MAX);
  if (p.monthlyPlan) {
    money(p.monthlyPlan.budget, "每月定投预算", BUDGET_MAX);
    if (p.monthlyPlan.budget <= 0) issues.push("每月定投预算需大于零。");
    const ids = p.monthlyPlan.assetIds;
    if (
      !ids.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => id === CASH_ID || !p.assets.some((a) => a.id === id))
    )
      issues.push("请选择有效的定投类别，现金不参与定投比例。");
    if (p.assets.some((a) => !ids.includes(a.id) && a.target > 0))
      issues.push("未选择的类别目标比例需为零。");
  }
  money(p.reserve, "备用金");
  if (!["external", "cash", "reserve"].includes(p.source))
    issues.push("投入来源无效。");
  if (![1, 10, 100].includes(p.rounding))
    issues.push("金额步长需为 1、10 或 100 元。");
  if (p.assets.length < 2 || p.assets.length > 16)
    issues.push("支持 2～16 个资产类别。");
  if (new Set(p.assets.map((a) => a.id)).size !== p.assets.length)
    issues.push("资产标识不能重复。");
  if (p.assets.filter((a) => a.id === CASH_ID).length !== 1)
    issues.push("需要保留现金类别。");
  let target = 0;
  for (const a of p.assets) {
    if (!a.id || !a.name.trim() || a.name.length > 40)
      issues.push("资产类别名称无效。");
    money(a.value, `${a.name}市值`);
    if (a.monthlyLimit !== null) money(a.monthlyLimit, `${a.name}额度`);
    if (
      !Number.isFinite(a.target) ||
      a.target < 0 ||
      a.target > 100 ||
      Math.abs(a.target * 100 - Math.round(a.target * 100)) > 0.0001
    )
      issues.push(`${a.name}目标比例无效。`);
    if (!Number.isFinite(a.shock) || a.shock < 0 || a.shock > 100)
      issues.push(`${a.name}假设跌幅需为 0～100%。`);
    target += a.target;
  }
  if (Math.abs(target - 100) > 0.00001) issues.push("目标比例合计需为 100%。");
  if (
    !Number.isFinite(p.reserveShock) ||
    p.reserveShock < 0 ||
    p.reserveShock > 100
  )
    issues.push("备用金假设跌幅无效。");
  if (
    forPlan &&
    p.source === "cash" &&
    p.budget > (p.assets.find((a) => a.id === CASH_ID)?.value || 0)
  )
    issues.push("本次预算超过组合中的可用现金。");
  if (forPlan && p.source === "reserve" && p.budget > p.reserve)
    issues.push("本次预算超过可用备用金。");
  return [...new Set(issues)];
}
