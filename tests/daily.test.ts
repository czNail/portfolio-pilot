import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMoneyInput, parseNumberInput } from "../src/domain/input";
import {
  buildAdjustment,
  dailySettings,
  dailyAllocation,
  planningSignature,
  reviewAfterDays,
} from "../src/domain/daily";
import { emptyPortfolio, cents, CASH_ID } from "../src/domain/model";
import { confirmStrategy } from "../src/domain/strategy";
import { envelope, parseBackup } from "../src/storage/backup";
import { calendarText } from "../src/domain/review";
function fixture() {
  const p = confirmStrategy(
    emptyPortfolio(),
    [40, 30, 10, 20, 0],
    undefined,
    "自定",
    true,
  );
  p.monthlyPlan = { budget: 4200, assetIds: ["us", "cn", "gold", "bonds"] };
  p.assets = p.assets.map((a, i) => ({
    ...a,
    value: [60000, 10000, 10000, 20000, 0][i],
  }));
  p.dailySettings = { budget: 200, cadence: "weekdays", rules: {} };
  return p;
}
test("金额加法按分求和，支持中文加号、千分位；拒绝残缺表达式、负数和超精度", () => {
  assert.equal(parseMoneyInput("￥1,200 + 3500.50＋.10"), 4700.6);
  assert.equal(parseMoneyInput("0.1+0.2"), 0.3);
  assert.equal(parseMoneyInput("", true), null);
  for (const value of [
    "1+",
    "+1",
    "1++2",
    "1-2",
    "-1",
    "1.001+2",
    "1e3",
    "1*2",
    "Infinity",
    "alert(1)",
    "1%+2",
    "900719925474099200",
  ])
    assert.ok(Number.isNaN(parseMoneyInput(value)!), value);
  assert.ok(Number.isNaN(parseNumberInput("20+30")!));
});
test("每日分配守恒；限购部分不挪到其他类别；0 和未填写限额不同", () => {
  const p = fixture(),
    s = dailySettings(p),
    original = dailyAllocation(p, s);
  s.rules.us = { dailyLimit: 10, buy: true, sell: true, note: "" };
  const capped = dailyAllocation(p, s);
  assert.equal(capped.rows[0].amount, 10);
  assert.equal(capped.unallocated, 70);
  assert.deepEqual(capped.rows.slice(1), original.rows.slice(1));
  s.rules.us.dailyLimit = 0;
  assert.equal(dailyAllocation(p, s).rows[0].amount, 0);
});
test("临时定投不卖出、不改实际持仓，买卖仅在用户选择时出现", () => {
  const p = fixture(),
    before = structuredClone(p);
  const recurring = buildAdjustment(
    p,
    dailySettings(p),
    "recurring",
    4000,
    100,
    200,
    "2026-10-26",
  );
  assert.equal(recurring.extra, 0);
  assert.equal(
    recurring.rows.reduce((s, r) => s + r.sell, 0),
    0,
  );
  assert.equal(recurring.rows[0].daily, 0);
  assert.deepEqual(p, before);
  const trade = buildAdjustment(
    p,
    dailySettings(p),
    "trade",
    0,
    20,
    200,
    "2026-10-26",
  );
  assert.equal(trade.rows[0].sell, 20000);
  assert.equal(
    trade.rows.reduce((s, r) => s + cents(r.buy), 0) +
      cents(trade.unallocatedOnce),
    2000000,
  );
  assert.equal(trade.days, 0);
});
test("混合方案合并计算同日限额，剩余额度不跨月自动恢复", () => {
  const p = fixture(),
    s = dailySettings(p);
  s.rules.cn = { dailyLimit: 50, buy: true, sell: false, note: "" };
  p.assets.find((a) => a.id === "cn")!.monthlyLimit = 65;
  const plan = buildAdjustment(p, s, "mixed", 1000, 20, 200, "2026-10-26");
  const r = plan.rows.find((r) => r.id === "cn")!;
  assert.ok(r.buy + r.daily <= 50);
  assert.ok(cents(r.buy) + cents(r.daily) * plan.days <= 6500);
  assert.ok(plan.unallocatedOnce > 0 || plan.unallocatedDaily > 0);
});
test("200 组限购和权限组合：不超额度、不越过卖出权限，所有资金与投影守恒", () => {
  for (let k = 0; k < 200; k++) {
    const p = fixture(),
      s = dailySettings(p);
    p.assets.forEach((a, i) => {
      if (a.id !== CASH_ID) {
        s.rules[a.id] = {
          dailyLimit: (k + i) % 3 ? (k * 17 + i * 13) % 500 : null,
          buy: (k + i) % 7 !== 0,
          sell: (k + i) % 5 !== 0,
          note: "",
        };
        a.monthlyLimit = (k + i) % 4 ? null : (k + i) * 10;
      }
    });
    const plan = buildAdjustment(
      p,
      s,
      "mixed",
      k * 10.01,
      20,
      200.03,
      "2026-10-26",
    );
    let buys = 0,
      sells = 0,
      daily = 0;
    for (const r of plan.rows) {
      const a = p.assets.find((a) => a.id === r.id)!,
        rule = s.rules[r.id];
      buys += cents(r.buy);
      sells += cents(r.sell);
      daily += cents(r.daily);
      assert.ok(rule.sell || r.sell === 0);
      assert.ok(rule.buy || (r.buy === 0 && r.daily === 0));
      if (rule.dailyLimit !== null)
        assert.ok(cents(r.buy) + cents(r.daily) <= cents(rule.dailyLimit));
      if (a.monthlyLimit !== null)
        assert.ok(cents(r.buy) + cents(r.daily) * 20 <= cents(a.monthlyLimit));
      assert.equal(
        cents(r.after),
        cents(a.value) - cents(r.sell) + cents(r.buy) + cents(r.daily) * 20,
      );
    }
    assert.equal(buys + cents(plan.unallocatedOnce), cents(plan.extra) + sells);
    assert.equal(daily + cents(plan.unallocatedDaily), cents(plan.dailyBudget));
    const finalAssets =
      plan.rows.reduce((sum, r) => sum + cents(r.after), 0) +
      cents(plan.unallocatedOnce) +
      cents(plan.unallocatedDaily) * 20;
    assert.equal(
      finalAssets,
      10000000 + cents(plan.extra) + cents(plan.dailyBudget) * 20,
    );
  }
});
test("旧 v4 保留原字段，新计划可刷新和备份恢复，损坏输入被拒绝", () => {
  const p = fixture();
  p.adjustment = buildAdjustment(
    p,
    dailySettings(p),
    "recurring",
    0,
    20,
    200,
    "2026-10-26",
  );
  assert.deepEqual(
    parseBackup(JSON.stringify(envelope(p))).portfolio,
    JSON.parse(JSON.stringify(p)),
  );
  assert.equal(p.adjustment.signature, planningSignature(p));
  const bad = structuredClone(p);
  bad.dailySettings!.rules.us = {
    dailyLimit: -1,
    buy: true,
    sell: true,
    note: "",
  };
  assert.throws(() => parseBackup(JSON.stringify(envelope(bad))));
  const badPlan = structuredClone(p);
  badPlan.adjustment!.days = 367;
  assert.throws(() => parseBackup(JSON.stringify(envelope(badPlan))));
  delete p.dailySettings;
  delete p.adjustment;
  assert.deepEqual(
    parseBackup(JSON.stringify(envelope(p))).portfolio,
    JSON.parse(JSON.stringify(p)),
  );
});
test("日期跳过周末但不冒充交易日历，临时日历不包含财务数据", () => {
  assert.equal(reviewAfterDays("2026-10-23", 2, "weekdays"), "2026-10-27");
  assert.equal(reviewAfterDays("2026-10-23", 2, "calendar"), "2026-10-25");
  const text = calendarText(
    "2026-11-01",
    new Date("2026-10-24T00:00:00Z"),
    true,
  );
  assert.match(text, /复查临时定投设置/);
  assert.match(text, /VALARM/);
  assert.doesNotMatch(text, /预算|市值|金额|200/);
});
