import { cents, yuan, totals, CASH_ID, type Portfolio } from "./model";
import { strategyConfirmed } from "./strategy";
import { rebalance, type Plan } from "./rebalance";
import { distributeUnits } from "./input";

export function deviation(p: Portfolio, plan?: Plan) {
  const total = plan?.portfolioAfter ?? totals(p).invested,
    band = p.strategy?.band ?? 5,
    relative = p.strategy?.relativeBand ?? 25;
  const rows = p.assets.map((a) => {
    const weight =
      total > 0
        ? ((plan?.rows.find((r) => r.id === a.id)?.after ?? a.value) / total) *
          100
        : 0;
    const delta = weight - a.target,
      limit = a.target > 0 ? Math.min(band, (a.target * relative) / 100) : band;
    return {
      id: a.id,
      weight,
      delta,
      limit,
      breached: total > 0 && Math.abs(delta) > limit + 1e-7,
    };
  });
  return {
    rows,
    max: total > 0 ? Math.max(...rows.map((r) => Math.abs(r.delta))) : 0,
    breached: rows.some((r) => r.breached),
    total,
  };
}
export function contributionToTarget(p: Portfolio): number | null {
  const total = totals(p).invested;
  if (p.assets.some((a) => a.target === 0 && a.value > 0)) return null;
  return Math.max(
    0,
    ...p.assets
      .filter((a) => a.target > 0)
      .map((a) => a.value / (a.target / 100) - total),
  );
}
export function describePlan(p: Portfolio, plan: Plan) {
  const before = deviation(p),
    after = deviation(p, plan),
    needed = contributionToTarget(p);
  let title: string, detail: string;
  if (!before.total) {
    title = "从第一笔投入开始";
    detail = "按已确认的目标比例分配，零头和受限金额留在组合现金。";
  } else if (!before.breached) {
    title = "当前配比在容忍范围内";
    detail = "不必为了微小偏差频繁交易；本次仍优先补足低配资产。";
  } else if (!after.breached) {
    title = "这笔投入可把偏差拉回范围";
    detail = "优先使用新资金，当前无需通过卖出恢复配比。";
  } else {
    title = "投入后仍有资产偏离目标";
    detail =
      "本次资金能补足部分低配资产，后续可继续投入，或查看含卖出的参考方案。";
  }
  return { before, after, needed, title, detail };
}
export function executePlan(
  p: Portfolio,
  expected: Plan,
  now = new Date().toISOString(),
): Portfolio {
  if (!strategyConfirmed(p)) throw new Error("请先确认长期策略。");
  const plan = rebalance(p);
  if (JSON.stringify(plan) !== JSON.stringify(expected))
    throw new Error("持仓或预算已改变，请重新查看计划。");
  if (plan.budget <= 0) throw new Error("本次预算为零，无需记录执行。");
  const record = {
    id: crypto.randomUUID(),
    executedAt: now,
    budget: p.budget,
    source: p.source,
    buys: p.assets
      .filter((a) => a.id !== CASH_ID)
      .map((a) => ({
        id: a.id,
        name: a.name,
        amount: plan.rows.find((r) => r.id === a.id)!.buy,
      }))
      .filter((a) => a.amount > 0),
    keptCash: plan.keptCash,
  };
  return {
    ...p,
    budget: 0,
    reserve: plan.reserveAfter,
    snapshot: { asOf: now.slice(0, 10), estimated: true },
    assets: p.assets.map((a) => {
      const row = plan.rows.find((r) => r.id === a.id)!;
      return {
        ...a,
        value: row.after,
        monthlyLimit:
          a.monthlyLimit === null
            ? null
            : yuan(Math.max(0, cents(a.monthlyLimit) - cents(row.buy))),
      };
    }),
    history: [record, ...(p.history ?? [])].slice(0, 20),
  };
}
export function snapshotAge(asOf: string | undefined, now = new Date()) {
  if (!asOf) return null;
  return Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.parse(asOf + "T00:00:00Z")) /
      86400000,
  );
}
export function fullRebalance(p: Portfolio, plan: Plan) {
  const desired = distributeUnits(
    p.assets.map((a) => a.target),
    cents(plan.portfolioAfter),
  );
  return p.assets.map((a, i) => {
    const current =
      cents(a.value) +
      (a.id === CASH_ID && p.source !== "cash" ? cents(p.budget) : 0);
    const change = yuan(desired[i] - current);
    return {
      id: a.id,
      name: a.name,
      change,
      after: yuan(desired[i]),
      limited:
        a.id !== CASH_ID && a.monthlyLimit !== null && change > a.monthlyLimit,
    };
  });
}
