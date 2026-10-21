import type { Asset, Portfolio } from "./model";
import { normaliseWeights } from "./input";

export const RULE_VERSION = "2026-10-v1";
export type RiskLevel = "protect" | "steady" | "balanced" | "growth";
export interface RiskProfile {
  horizon: "under1" | "1to3" | "3to7" | "over7";
  reserve: "under3" | "3to6" | "over6";
  loss: 10 | 20 | 35 | 50;
  reaction: "sell" | "hold" | "buy";
  region: "equal" | "us" | "cn";
}
export interface AllocationStrategy {
  ruleVersion: typeof RULE_VERSION;
  revision: number;
  label: string;
  confirmedAt: string;
  targets: Record<string, number>;
  band: number;
  relativeBand: number;
  custom: boolean;
}
export const LEVELS: Record<
  RiskLevel,
  {
    label: string;
    equity: number;
    gold: number;
    bonds: number;
    cash: number;
    description: string;
  }
> = {
  protect: {
    label: "流动性优先",
    equity: 0,
    gold: 0,
    bonds: 0,
    cash: 100,
    description: "先保留近期要用的钱和生活安全垫。",
  },
  steady: {
    label: "稳健型",
    equity: 10,
    gold: 5,
    bonds: 20,
    cash: 65,
    description: "保留较高现金比例，以少量权益参与长期增长。",
  },
  balanced: {
    label: "平衡型",
    equity: 35,
    gold: 10,
    bonds: 30,
    cash: 25,
    description: "在权益增长与债券、现金缓冲之间取得平衡。",
  },
  growth: {
    label: "成长型",
    equity: 65,
    gold: 10,
    bonds: 20,
    cash: 5,
    description: "接受较大波动，主要为长期目标配置。",
  },
};
export const riskChoices = {
  horizon: [
    ["under1", "1 年内", "近期就要用"],
    ["1to3", "1～3 年", "中短期目标"],
    ["3to7", "3～7 年", "可以持续持有"],
    ["over7", "7 年以上", "长期积累"],
  ],
  reserve: [
    ["under3", "不足 3 个月", "生活开支安全垫还不充分"],
    ["3to6", "3～6 个月", "已有一定缓冲"],
    ["over6", "6 个月以上", "安全垫已单独留好"],
  ],
  loss: [
    [10, "亏损 10%", "10 万元变成 9 万元"],
    [20, "亏损 20%", "10 万元变成 8 万元"],
    [35, "亏损 35%", "10 万元变成 6.5 万元"],
    [50, "亏损 50%", "10 万元变成 5 万元"],
  ],
  reaction: [
    ["sell", "倾向卖出", "担心进一步亏损"],
    ["hold", "继续持有", "接受波动，等待恢复"],
    ["buy", "按计划继续投入", "有余力，也能坚持"],
  ],
  region: [
    ["equal", "均衡分配", "美股与 A 股各占权益的一半"],
    ["us", "偏好美股", "美股占权益的 2/3"],
    ["cn", "偏好 A 股", "A 股占权益的 2/3"],
  ],
} as const;
export function validProfile(value: unknown): value is RiskProfile {
  if (!value || typeof value !== "object") return false;
  const p = value as RiskProfile;
  return Object.entries(riskChoices).every(([key, choices]) =>
    choices.some((c) => c[0] === p[key as keyof RiskProfile]),
  );
}
export function recommend(profile: RiskProfile, assets: readonly Asset[]) {
  if (!validProfile(profile)) throw new Error("请完成风险评估。");
  const capacity = Math.min(
    { under1: -1, "1to3": 0, "3to7": 1, over7: 2 }[profile.horizon],
    { under3: -1, "3to6": 1, over6: 2 }[profile.reserve],
  );
  const willingness = Math.min(
    { 10: 0, 20: 0, 35: 1, 50: 2 }[profile.loss],
    { sell: 0, hold: 1, buy: 2 }[profile.reaction],
  );
  let level: RiskLevel =
    (["steady", "balanced", "growth"] as const)[
      Math.min(capacity, willingness)
    ] ?? "protect";
  const weights = (l: RiskLevel) => {
    const t = LEVELS[l],
      usShare =
        profile.region === "us"
          ? 2 / 3
          : profile.region === "cn"
            ? 1 / 3
            : 1 / 2;
    const values = assets.map((a) =>
      a.id === "us"
        ? t.equity * usShare
        : a.id === "cn"
          ? t.equity * (1 - usShare)
          : a.id === "gold"
            ? t.gold
            : a.id === "bonds"
              ? t.bonds
              : a.id === "cash"
                ? t.cash
                : 0,
    );
    return normaliseWeights(values);
  };
  // A changed stress assumption may make a template unsuitable. Step down
  // rather than implying that a questionnaire can guarantee a loss ceiling.
  while (
    level !== "protect" &&
    scenarioRate(assets, weights(level)) > profile.loss
  ) {
    level =
      level === "growth"
        ? "balanced"
        : level === "balanced"
          ? "steady"
          : "protect";
  }
  const reasons = [
    profile.horizon === "under1"
      ? "一年内要使用的资金优先保留流动性。"
      : `投资期限为${riskChoices.horizon.find((x) => x[0] === profile.horizon)![1]}，限制了可采用的风险档位。`,
    profile.reserve === "under3"
      ? "备用金不足 3 个月，建议先补足安全垫。"
      : `已有${riskChoices.reserve.find((x) => x[0] === profile.reserve)![1]}生活开支的备用金。`,
    `结合可接受的 ${profile.loss}% 亏损和下跌时的行为，采用财务能力与心理意愿中更谨慎的一档。`,
  ];
  return {
    level,
    ...LEVELS[level],
    weights: weights(level),
    reasons,
    capacity,
    willingness,
  };
}
export function scenarioRate(
  assets: readonly Asset[],
  weights = assets.map((a) => a.target),
) {
  return assets.reduce((s, a, i) => s + (weights[i] * a.shock) / 100, 0);
}
export function targetsOf(assets: readonly Asset[]) {
  return Object.fromEntries(assets.map((a) => [a.id, a.target]));
}
export function strategyConfirmed(p: Portfolio) {
  return (
    !!p.strategy &&
    p.strategy.ruleVersion === RULE_VERSION &&
    p.assets.length === Object.keys(p.strategy.targets).length &&
    p.assets.every((a) => p.strategy!.targets[a.id] === a.target)
  );
}
export function confirmStrategy(
  p: Portfolio,
  weights: number[],
  profile: RiskProfile | undefined,
  label: string,
  custom: boolean,
  band = 5,
  now = new Date().toISOString(),
): Portfolio {
  if (
    weights.length !== p.assets.length ||
    weights.some((w) => !Number.isFinite(w) || w < 0 || w > 100) ||
    Math.abs(weights.reduce((s, w) => s + w, 0) - 100) > 1e-6
  )
    throw new Error("目标比例合计需为 100%。");
  const assets = p.assets.map((a, i) => ({ ...a, target: weights[i] }));
  return {
    ...p,
    assets,
    riskProfile: profile,
    strategy: {
      ruleVersion: RULE_VERSION,
      revision: (p.strategy?.revision ?? 0) + 1,
      label,
      confirmedAt: now,
      targets: targetsOf(assets),
      custom,
      band,
      relativeBand: 25,
    },
  };
}
