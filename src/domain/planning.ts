import { cents, yuan, totals, CASH_ID, newId, type Portfolio } from "./model";
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
    id: newId("execution"),
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
  const step = cents(p.rounding);
  const cash = p.assets.findIndex((a) => a.id === CASH_ID);
  const current = p.assets.map(
    (a) =>
      cents(a.value) +
      (a.id === CASH_ID && p.source !== "cash" ? cents(p.budget) : 0),
  );
  const changes = desired.map((v, i) =>
    i === cash
      ? 0
      : Math.sign(v - current[i]) *
        Math.floor(Math.abs(v - current[i]) / step) *
        step,
  );
  // Round transactions, not market values. Any unspent remainder stays in cash.
  // Rounded sales may free less than exact sales, so reduce purchases if needed.
  let remaining = current[cash] - changes.reduce((s, n) => s + n, 0);
  while (remaining < 0) {
    const index = changes.findIndex((n) => n > 0);
    if (index < 0) throw new Error("买卖资金不足。");
    changes[index] -= step;
    remaining += step;
  }
  changes[cash] = remaining - current[cash];
  return p.assets.map((a, i) => {
    const change = yuan(changes[i]);
    return {
      id: a.id,
      name: a.name,
      change,
      after: yuan(current[i] + changes[i]),
      limited:
        a.id !== CASH_ID && a.monthlyLimit !== null && change > a.monthlyLimit,
    };
  });
}
// Lower bound for a buy-only recovery: prices, fees, caps and rounding ignored.
// The final value of each asset must stay above its current holding and within
// the configured weight band. Binary search the smallest feasible total.
export function additionalToBand(p: Portfolio) {
  const d = deviation(p);
  if (!d.breached) return 0;
  const current = p.assets.map((a) => a.value),
    total = d.total;
  const possible = (value: number) => {
    let minimum = 0;
    for (let i = 0; i < current.length; i++) {
      const row = d.rows[i],
        lower = Math.max(0, p.assets[i].target - row.limit) / 100,
        upper = Math.min(100, p.assets[i].target + row.limit) / 100;
      if (current[i] > upper * value + 1e-7) return false;
      minimum += Math.max(current[i], lower * value);
    }
    return minimum <= value + 1e-7;
  };
  let low = total,
    high = Math.max(total, 1);
  while (!possible(high) && high < 1e18) high *= 2;
  if (!possible(high)) return null;
  for (let i = 0; i < 70; i++) {
    const mid = (low + high) / 2;
    if (possible(mid)) high = mid;
    else low = mid;
  }
  return Math.max(0, Math.ceil((high - total) * 100 - 1e-5) / 100);
}
