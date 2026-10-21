import {
  CASH_ID,
  cents,
  yuan,
  totals,
  validate,
  type Portfolio,
} from "./model";
export interface AssetPlan {
  id: string;
  current: number;
  after: number;
  buy: number;
  change: number;
  beforeWeight: number;
  afterWeight: number;
  target: number;
}
export interface Plan {
  budget: number;
  bought: number;
  keptCash: number;
  portfolioAfter: number;
  totalAfter: number;
  reserveAfter: number;
  rows: AssetPlan[];
  maxBefore: number;
  maxAfter: number;
}
export function rebalance(p: Portfolio): Plan {
  const issues = validate(p, { forPlan: true });
  if (issues.length) throw new Error(issues.join("\n"));
  const current = p.assets.map((a) => cents(a.value)),
    total = current.reduce((s, v) => s + v, 0),
    budget = cents(p.budget),
    step = cents(p.rounding),
    cash = p.assets.findIndex((a) => a.id === CASH_ID);
  const totalAfter = total + (p.source === "cash" ? 0 : budget),
    goals = p.assets.map((a) => (totalAfter * a.target) / 100),
    after = [...current],
    buys = p.assets.map(() => 0);
  if (p.source !== "cash") after[cash] += budget;
  const caps = p.assets.map((a, i) =>
    Math.min(
      budget,
      a.monthlyLimit === null ? budget : cents(a.monthlyLimit),
      Math.max(0, Math.floor((goals[i] - current[i] + 1e-7) / step) * step),
    ),
  );
  let left = budget;
  // Every purchase transfers one unit from cash. The shared cash term means
  // greedy marginal improvement is exact for the separable convex objective
  // on this uniform integer grid, under monthly caps and target-amount caps.
  while (left >= step) {
    let best = -1,
      gain = 0;
    for (let i = 0; i < after.length; i++) {
      if (i === cash || buys[i] + step > caps[i]) continue;
      const improvement =
        goals[i] - after[i] + after[cash] - goals[cash] - step;
      if (improvement > gain + 1e-7) {
        gain = improvement;
        best = i;
      }
    }
    if (best < 0) break;
    after[best] += step;
    after[cash] -= step;
    buys[best] += step;
    left -= step;
  }
  const reserveAfter = p.reserve - (p.source === "reserve" ? p.budget : 0),
    rows = p.assets.map((a, i) => ({
      id: a.id,
      current: yuan(current[i]),
      after: yuan(after[i]),
      buy: yuan(buys[i]),
      change: yuan(after[i] - current[i]),
      beforeWeight: total ? (current[i] / total) * 100 : 0,
      afterWeight: totalAfter ? (after[i] / totalAfter) * 100 : 0,
      target: a.target,
    }));
  return {
    budget: p.budget,
    bought: yuan(budget - left),
    keptCash: yuan(left),
    portfolioAfter: yuan(totalAfter),
    totalAfter: yuan(totalAfter) + reserveAfter,
    reserveAfter,
    rows,
    maxBefore: total
      ? Math.max(...rows.map((r) => Math.abs(r.beforeWeight - r.target)))
      : 0,
    maxAfter: totalAfter
      ? Math.max(...rows.map((r) => Math.abs(r.afterWeight - r.target)))
      : 0,
  };
}
export function stress(p: Portfolio, plan?: Plan) {
  const issues = validate(p);
  if (issues.length) throw new Error(issues.join("\n"));
  const rows = p.assets.map((a) => {
    const value = plan?.rows.find((r) => r.id === a.id)?.after ?? a.value;
    return {
      id: a.id,
      name: a.name,
      value,
      shock: a.shock,
      loss: (value * a.shock) / 100,
    };
  });
  const reserve = plan?.reserveAfter ?? p.reserve;
  if (reserve > 0)
    rows.push({
      id: "reserve",
      name: "备用金",
      value: reserve,
      shock: p.reserveShock,
      loss: (reserve * p.reserveShock) / 100,
    });
  const total = plan?.totalAfter ?? totals(p).total,
    loss = rows.reduce((s, a) => s + a.loss, 0),
    rate = total ? (loss / total) * 100 : 0;
  return { rows, total, loss, rate, remaining: total - loss };
}
