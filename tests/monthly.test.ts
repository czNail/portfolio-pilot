import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyPortfolio,
  demoPortfolio,
  cents,
  type Portfolio,
} from "../src/domain/model";
import { confirmStrategy, type RiskProfile } from "../src/domain/strategy";
import {
  recommendSelected,
  monthlyAllocation,
  monthlyReady,
  mixWarnings,
} from "../src/domain/monthly";
import {
  additionalToBand,
  deviation,
  executePlan,
} from "../src/domain/planning";
import { rebalance } from "../src/domain/rebalance";
import { envelope, parseBackup } from "../src/storage/backup";
const profile: RiskProfile = {
  horizon: "over7",
  reserve: "over6",
  loss: 35,
  reaction: "hold",
  region: "equal",
};
function plan(budget = 4000): Portfolio {
  const p = demoPortfolio();
  return {
    ...confirmStrategy(
      { ...p, demo: false },
      [40, 35, 25, 0, 0],
      profile,
      "自定",
      true,
    ),
    monthlyPlan: { budget, assetIds: ["us", "cn", "gold"] },
  };
}
test("月预算全部分给所选类别，没有再次留现金、也不受现有持仓影响", () => {
  const p = plan(4000.01),
    a = monthlyAllocation(p);
  assert.equal(
    a.rows.reduce((s, r) => s + cents(r.amount), 0),
    cents(4000.01),
  );
  assert.deepEqual(
    a.rows.map((r) => r.id),
    ["us", "cn", "gold"],
  );
  p.assets = p.assets.map((a, i) => ({ ...a, value: (i + 1) * 1234 }));
  assert.deepEqual(monthlyAllocation(p), a);
  assert.equal(monthlyReady(emptyPortfolio()), false);
});
test("不选债券时推荐不会偷偷加入债券或现金，会提示风险不匹配", () => {
  const p = emptyPortfolio(),
    ids = ["us", "cn", "gold"],
    r = recommendSelected(profile, p.assets, ids);
  assert.equal(r.weights[3], 0);
  assert.equal(r.weights[4], 0);
  assert.equal(
    r.weights.reduce((s, w) => s + Math.round(w * 100), 0),
    10000,
  );
  const warnings = mixWarnings(p.assets, r.weights, profile);
  assert.ok(warnings.some((w) => w.code === "no-bonds"));
  assert.ok(warnings.some((w) => w.code === "loss" && w.critical));
  assert.throws(() => recommendSelected(profile, p.assets, []));
});
test("单一类别与全权益会提示，不把大类数量等同于充分分散", () => {
  const p = emptyPortfolio();
  assert.ok(
    mixWarnings(p.assets, [100, 0, 0, 0, 0], profile).some(
      (w) => w.code === "single",
    ),
  );
  assert.ok(
    mixWarnings(p.assets, [50, 50, 0, 0, 0], profile).some(
      (w) => w.code === "equity",
    ),
  );
  const r = recommendSelected(profile, p.assets, ["bonds"]);
  assert.deepEqual(r.weights, [0, 0, 0, 100, 0]);
});
test("再平衡单次预算与月预算独立，执行和重载不清空固定计划", () => {
  const p = plan();
  p.budget = 1000;
  const next = executePlan(p, rebalance(p));
  assert.equal(next.budget, 0);
  assert.equal(next.monthlyPlan!.budget, 4000);
  const restored = parseBackup(JSON.stringify(envelope(next))).portfolio;
  assert.deepEqual(restored.monthlyPlan, p.monthlyPlan);
  assert.equal(monthlyAllocation(restored).budget, 4000);
});
test("额度提示不改写固定比例，纠偏仍遵守本月限制", () => {
  const p = plan();
  p.assets[0].monthlyLimit = 10;
  assert.ok(monthlyAllocation(p).rows.find((r) => r.id === "us")!.limited);
  assert.equal(
    monthlyAllocation(p).rows.find((r) => r.id === "us")!.amount,
    1600,
  );
  assert.ok(rebalance(p).rows[0].buy <= 10);
});
test("仅用新资金回到容忍范围的资金下界，边界与零目标持仓均有限且可核验", () => {
  const p = plan(),
    amount = additionalToBand(p);
  assert.ok(amount !== null && amount > 0);
  const total = p.assets.reduce((s, a) => s + a.value, 0),
    d = deviation(p),
    after = total + amount;
  assert.ok(
    d.rows.every(
      (r, i) =>
        p.assets[i].value <=
        (after * Math.min(100, p.assets[i].target + r.limit)) / 100 + 1e-6,
    ),
  );
  const balanced = plan();
  balanced.assets = balanced.assets.map((a) => ({
    ...a,
    value: a.target * 1000,
  }));
  assert.equal(additionalToBand(balanced), 0);
});
test("导入拒绝无效月预算、重复类别、现金类别和未选类别非零目标", () => {
  for (const edit of [
    (p: any) => (p.monthlyPlan.budget = -1),
    (p: any) => (p.monthlyPlan.assetIds = ["us", "us"]),
    (p: any) => (p.monthlyPlan.assetIds = ["cash"]),
    (p: any) => (p.assets[4].target = 1),
  ]) {
    const e = envelope(plan());
    edit(e.portfolio);
    assert.throws(() => parseBackup(JSON.stringify(e)));
  }
});
