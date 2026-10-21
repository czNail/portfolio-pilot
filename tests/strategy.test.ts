import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyPortfolio,
  demoPortfolio,
  cents,
  totals,
} from "../src/domain/model";
import {
  scenarioRate,
  riskChoices,
  confirmStrategy,
  strategyConfirmed,
  type RiskProfile,
} from "../src/domain/strategy";
import {
  deviation,
  contributionToTarget,
  executePlan,
  fullRebalance,
  snapshotAge,
} from "../src/domain/planning";
import { rebalance } from "../src/domain/rebalance";
import { envelope, parseBackup, STORAGE_KEY } from "../src/storage/backup";
import { loadPortfolio } from "../src/storage/session";
import { recommendSelected, mixWarnings } from "../src/domain/monthly";
const recommend = (
  profile: RiskProfile,
  assets: ReturnType<typeof emptyPortfolio>["assets"],
) =>
  recommendSelected(
    profile,
    assets,
    assets.filter((a) => a.id !== "cash").map((a) => a.id),
  );
const profile: RiskProfile = {
  horizon: "over7",
  reserve: "over6",
  loss: 50,
  reaction: "buy",
  region: "equal",
};
const confirmed = () => {
  const p = demoPortfolio();
  return confirmStrategy(
    { ...p, demo: false },
    p.assets.map((a) => a.target),
    profile,
    "自定策略",
    true,
  );
};
test("所有问卷组合均有确定性结果，比例精确守恒且情景不超过填写的亏损幅度", () => {
  const p = emptyPortfolio();
  for (const [horizon] of riskChoices.horizon)
    for (const [reserve] of riskChoices.reserve)
      for (const [loss] of riskChoices.loss)
        for (const [reaction] of riskChoices.reaction)
          for (const [region] of riskChoices.region) {
            const input = { horizon, reserve, loss, reaction, region },
              r = recommend(input, p.assets);
            assert.deepEqual(r, recommend(input, p.assets));
            assert.equal(
              r.weights.reduce((s, w) => s + Math.round(w * 100), 0),
              10000,
            );
            assert.ok(scenarioRate(p.assets, r.weights) <= loss + 1e-7);
            if (horizon === "under1" || reserve === "under3")
              assert.equal(r.level, "protect");
          }
});
test("期限与安全垫限制主观风险意愿，区域偏好不提高权益比例", () => {
  const p = emptyPortfolio(),
    r = recommend(profile, p.assets);
  assert.equal(r.level, "growth");
  assert.equal(
    recommend({ ...profile, horizon: "1to3" }, p.assets).level,
    "steady",
  );
  assert.equal(
    recommend({ ...profile, reserve: "3to6" }, p.assets).level,
    "balanced",
  );
  assert.equal(
    recommend({ ...profile, reaction: "sell" }, p.assets).level,
    "steady",
  );
  const us = recommend({ ...profile, region: "us" }, p.assets);
  assert.equal(us.weights[0] + us.weights[1], r.weights[0] + r.weights[1]);
  assert.ok(us.weights[0] > us.weights[1]);
  p.assets[0].shock = 100;
  p.assets[1].shock = 100;
  assert.ok(
    mixWarnings(p.assets, recommend(profile, p.assets).weights, profile).some(
      (w) => w.code === "loss" && w.critical,
    ),
  );
});
test("只有明确确认且目标一致时，才视为已制定策略", () => {
  const p = emptyPortfolio();
  assert.equal(strategyConfirmed(p), false);
  const next = confirmStrategy(
    p,
    [20, 20, 10, 40, 10],
    profile,
    "平衡型",
    false,
  );
  assert.equal(strategyConfirmed(next), true);
  assert.equal(next.strategy!.revision, 1);
  assert.equal(p.strategy, undefined);
  next.assets[0].target = 21;
  assert.equal(strategyConfirmed(next), false);
  assert.throws(() => confirmStrategy(p, [50, 50], profile, "自定", true));
});
test("相对偏差保护小比例类别，新增资金不足或零目标均能明确识别", () => {
  const p = confirmed();
  p.assets = p.assets.map((a) => ({ ...a, value: a.target * 1000 }));
  p.assets[4].value += 2000;
  p.assets[0].value -= 2000;
  const d = deviation(p);
  assert.ok(Math.abs(d.max - 2) < 1e-9);
  assert.equal(d.breached, true);
  assert.ok(d.rows.find((a) => a.id === "cash")!.breached);
  assert.ok(contributionToTarget(p)! > 0);
  p.assets[4].target = 0;
  assert.equal(contributionToTarget(p), null);
});
test("记录执行不改变原始输入，预算只记一次，现金与额度按分守恒", () => {
  const p = confirmed();
  p.assets[3].monthlyLimit = 3000;
  const before = structuredClone(p),
    plan = rebalance(p),
    next = executePlan(p, plan, "2026-10-21T10:00:00Z");
  assert.deepEqual(p, before);
  assert.equal(next.budget, 0);
  assert.equal(next.snapshot!.estimated, true);
  assert.equal(next.snapshot!.asOf, "2026-10-21");
  assert.equal(next.history!.length, 1);
  assert.equal(cents(totals(next).total), cents(totals(p).total + p.budget));
  assert.equal(next.assets[3].monthlyLimit, 3000 - plan.rows[3].buy);
  assert.throws(() => executePlan(next, rebalance(next)));
  assert.equal(strategyConfirmed(next), true);
  assert.equal(
    next.history![0].buys.reduce((s, r) => s + cents(r.amount), 0) +
      cents(next.history![0].keptCash),
    cents(p.budget),
  );
});
test("执行时拒绝过期的计划，资金来源不重复增加总资产", () => {
  for (const source of ["cash", "reserve"] as const) {
    const p = confirmed();
    p.source = source;
    p.reserve = 5000;
    p.assets[4].value = 5000;
    const plan = rebalance(p);
    const next = executePlan(p, plan);
    assert.equal(cents(totals(next).total), cents(totals(p).total));
  }
  const p = confirmed(),
    oldPlan = rebalance(p);
  p.budget += 10;
  assert.throws(() => executePlan(p, oldPlan));
});
test("含卖出参考金额守恒，能标注超额度；零目标不出现除零", () => {
  const p = confirmed(),
    plan = rebalance(p),
    rows = fullRebalance(p, plan);
  assert.equal(
    rows.reduce((s, r) => s + cents(r.after), 0),
    cents(plan.portfolioAfter),
  );
  assert.equal(
    rows.reduce((s, r) => s + cents(r.change), 0),
    0,
  );
  assert.ok(rows.some((r) => r.change < 0));
  p.assets[3].monthlyLimit = 0;
  assert.ok(
    fullRebalance(p, rebalance(p)).find((r) => r.id === "bonds")!.limited,
  );
  assert.equal(snapshotAge(undefined), null);
  assert.equal(snapshotAge("2026-10-01", new Date("2026-10-21T12:00:00")), 20);
});
test("新版备份完整恢复策略、持仓日期与记录；不读取旧存储", () => {
  const p = confirmed(),
    next = executePlan(p, rebalance(p));
  assert.deepEqual(parseBackup(JSON.stringify(envelope(next))).portfolio, next);
  const seen: string[] = [];
  const loaded = loadPortfolio({
    getItem: (key) => {
      seen.push(key);
      return null;
    },
  });
  assert.deepEqual(seen, [STORAGE_KEY]);
  assert.equal(loaded.p.strategy, undefined);
  assert.throws(() =>
    parseBackup(JSON.stringify({ ...envelope(p), schemaVersion: 2 })),
  );
  assert.equal(loadPortfolio({ getItem: () => "{invalid" }).blocked, true);
});
test("损坏的策略、风险问卷、日期和执行记录会拒绝导入", () => {
  for (const edit of [
    (e: any) => (e.portfolio.strategy.band = NaN),
    (e: any) => (e.portfolio.strategy.targets.us = -1),
    (e: any) => (e.portfolio.riskProfile.loss = 99),
    (e: any) =>
      (e.portfolio.snapshot = { asOf: "2026-02-30", estimated: false }),
    (e: any) => (e.portfolio.history = [{ id: "bad" }]),
    (e: any) => (e.portfolio.assets[0].value = -1),
  ]) {
    const e = envelope(confirmed());
    edit(e);
    assert.throws(() => parseBackup(JSON.stringify(e)));
  }
});
