import {
  BUDGET_MAX,
  CASH_ID,
  cents,
  yuan,
  type Asset,
  type Portfolio,
} from "./model";
import { distributeUnits, normaliseWeights } from "./input";
import {
  riskChoices,
  scenarioRate,
  strategyConfirmed,
  validProfile,
  type RiskProfile,
  type RiskLevel,
} from "./strategy";
export interface MonthlyPlan {
  budget: number;
  assetIds: string[];
}
export interface MixWarning {
  code: string;
  title: string;
  detail: string;
  critical: boolean;
}
const knownEquity = new Set(["us", "cn"]);
export function recommendSelected(
  profile: RiskProfile,
  assets: readonly Asset[],
  assetIds: readonly string[],
) {
  if (!validProfile(profile)) throw new Error("请完成风险评估。");
  const selected = assets.filter(
    (a) => a.id !== CASH_ID && assetIds.includes(a.id),
  );
  if (!selected.length) throw new Error("至少选择一种定投类别。");
  const capacity = Math.min(
    { under1: -1, "1to3": 0, "3to7": 1, over7: 2 }[profile.horizon],
    { under3: -1, "3to6": 1, over6: 2 }[profile.reserve],
  );
  const willingness = Math.min(
    { 10: -1, 20: 0, 35: 1, 50: 2 }[profile.loss],
    { sell: 0, hold: 1, buy: 2 }[profile.reaction],
  );
  const level: RiskLevel =
    (["steady", "balanced", "growth"] as const)[
      Math.min(capacity, willingness)
    ] ?? "protect";
  const templates = {
    protect: { equity: 0, gold: 0, bonds: 100, label: "谨慎型" },
    steady: { equity: 15, gold: 5, bonds: 80, label: "稳健型" },
    balanced: { equity: 45, gold: 10, bonds: 45, label: "平衡型" },
    growth: { equity: 70, gold: 10, bonds: 20, label: "成长型" },
  };
  const t = templates[level],
    usShare =
      profile.region === "us" ? 2 / 3 : profile.region === "cn" ? 1 / 3 : 1 / 2;
  const base = selected.map((a) =>
    a.id === "us"
      ? t.equity * usShare
      : a.id === "cn"
        ? t.equity * (1 - usShare)
        : a.id === "gold"
          ? t.gold
          : a.id === "bonds"
            ? t.bonds
            : 0,
  );
  // Preserve the chosen investment universe. A missing defensive asset must
  // produce an explicit warning, never an unselected purchase or cash target.
  const values = normaliseWeights(
    base.some((v) => v > 0) ? base : selected.map(() => 1),
  );
  const weights = assets.map((a) => {
    const i = selected.findIndex((s) => s.id === a.id);
    return i >= 0 ? values[i] : 0;
  });
  const reasons = [
    `每月预算已扣除预留现金，100% 在你选定的 ${selected.length} 类投资资产中分配。`,
    `结合${riskChoices.horizon.find((c) => c[0] === profile.horizon)![1]}期限、备用金与下跌行为，采用${t.label}作为比例起点。`,
    "按选择的类别重新归一化；如果缺少防御资产或超过亏损承受幅度，会明确提示，仍由你决定是否采用。",
  ];
  return {
    level,
    label: t.label,
    description: "只在选定类别内生成投资组合比例，不额外预留现金。",
    weights,
    reasons,
  };
}
export function mixWarnings(
  assets: readonly Asset[],
  weights: number[],
  profile?: RiskProfile,
): MixWarning[] {
  const active = assets.filter(
      (_, i) => weights[i] > 0 && assets[i].id !== CASH_ID,
    ),
    w = (id: string) => weights[assets.findIndex((a) => a.id === id)] ?? 0;
  const warnings: MixWarning[] = [];
  const add = (code: string, title: string, detail: string, critical = false) =>
    warnings.push({ code, title, detail, critical });
  if (active.length === 1)
    add(
      "single",
      "集中于单一资产类别",
      "单一类别的波动会直接影响整个投资组合；持有多只同类基金也不能替代跨资产分散。",
    );
  const equity = assets.reduce(
    (s, a, i) => s + (knownEquity.has(a.id) ? weights[i] : 0),
    0,
  );
  if (equity >= 80)
    add(
      "equity",
      "权益资产占比较高",
      `股票类合计 ${Number(equity.toFixed(2))}%。美股与 A 股仍同属权益，市场下跌时可能同时承压。`,
    );
  if (w("bonds") === 0)
    add(
      "no-bonds",
      "当前没有债券配置",
      "可以不选债券。组合少了一类常见的防御资产；黄金仍可能大幅波动，不能视作债券或现金的等价替代。",
    );
  if (w("gold") > 30)
    add(
      "gold",
      "黄金占比较高",
      "黄金超过组合的 30%，对单一商品价格的依赖较强。30% 是本工具的集中度提醒规则，不是通用安全线。",
    );
  if (active.some((a) => !["us", "cn", "gold", "bonds"].includes(a.id)))
    add(
      "unknown",
      "有类别需要自行核对风险",
      "自定义类别尚未进行底层资产和相关性识别，请自行确认是否与现有股票、债券重叠。",
    );
  const rate = scenarioRate(assets, weights);
  if (profile && rate > profile.loss + 1e-7)
    add(
      "loss",
      "超出填写的亏损承受幅度",
      `当前下跌情景约 ${Number(rate.toFixed(2))}%，超过你选择的 ${profile.loss}%。可增加防御资产、调整比例或减少投入风险资产的资金。`,
      true,
    );
  if (profile && (profile.horizon === "under1" || profile.reserve === "under3"))
    add(
      "capacity",
      "资金期限或安全垫不适合这份投入计划",
      "一年内要用的资金或不足的生活安全垫，应先保留流动性。当前所选投资类别无法替代应急现金，可降低月预算或暂缓定投。",
      true,
    );
  return warnings;
}
export function monthlyReady(p: Portfolio) {
  return (
    strategyConfirmed(p) &&
    !!p.monthlyPlan &&
    p.monthlyPlan.budget > 0 &&
    p.assets.every(
      (a) =>
        (a.id !== CASH_ID && p.monthlyPlan!.assetIds.includes(a.id)) ||
        a.target === 0,
    )
  );
}
export function monthlyAllocation(p: Portfolio) {
  if (!monthlyReady(p)) throw new Error("请先确认每月定投预算、类别和比例。");
  const budget = p.monthlyPlan!.budget;
  if (
    !Number.isFinite(budget) ||
    budget <= 0 ||
    budget > BUDGET_MAX ||
    Math.abs(budget * 100 - Math.round(budget * 100)) > 0.0001
  )
    throw new Error("每月预算需为正金额，最多两位小数。");
  const amounts = distributeUnits(
    p.assets.map((a) => a.target),
    cents(budget),
  );
  return {
    budget,
    rows: p.assets
      .map((a, i) => ({
        id: a.id,
        name: a.name,
        target: a.target,
        amount: yuan(amounts[i]),
        limited: a.monthlyLimit !== null && yuan(amounts[i]) > a.monthlyLimit,
      }))
      .filter((r) => r.target > 0),
  };
}
