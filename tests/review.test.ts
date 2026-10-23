import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyPortfolio,
  cents,
  totals,
  type Portfolio,
} from "../src/domain/model";
import { confirmStrategy } from "../src/domain/strategy";
import {
  addMonths,
  localDate,
  validDate,
  beginReview,
  reviewState,
  capture,
  finishReview,
  calendarText,
} from "../src/domain/review";
import { fullRebalance, deviation } from "../src/domain/planning";
import { rebalance } from "../src/domain/rebalance";
import { envelope, parseBackup, STORAGE_KEY } from "../src/storage/backup";
import { loadPortfolio } from "../src/storage/session";
import { reportText } from "../src/domain/report";

const now = new Date("2026-10-31T12:00:00Z");
function portfolio(drift = false): Portfolio {
  const p = confirmStrategy(
    emptyPortfolio(),
    [25, 20, 10, 45, 0],
    undefined,
    "自己的配置",
    true,
  );
  return {
    ...p,
    budget: 4000,
    monthlyPlan: { budget: 4000, assetIds: ["us", "cn", "gold", "bonds"] },
    assets: p.assets.map((a, i) => ({
      ...a,
      value: (drift
        ? [50000, 15000, 10000, 25000, 0]
        : [25000, 20000, 10000, 45000, 0])[i],
    })),
    snapshot: { asOf: "2026-10-31", estimated: false },
  };
}
function ready(drift = false) {
  const p = beginReview(portfolio(drift), now);
  p.review!.active!.phase = "result";
  p.review!.active!.before = capture(p);
  return p;
}
test("按自然月安排复查，月末、闰年和非法日期处理正确", () => {
  assert.equal(addMonths("2026-10-31", 6), "2027-04-30");
  assert.equal(addMonths("2027-11-30", 3), "2028-02-29");
  assert.equal(addMonths("2028-02-29", 12), "2029-02-28");
  assert.equal(validDate("2026-02-30"), false);
  assert.throws(() => addMonths("2026-02-30", 6));
  const d = new Date(2026, 9, 31, 23, 59);
  assert.equal(localDate(d), "2026-10-31");
});
test("开始复查只清空单次资金，既有月预算不累计；重开不丢待完成方案", () => {
  const original = portfolio(),
    p = beginReview(original, now);
  assert.equal(original.budget, 4000);
  assert.equal(p.budget, 0);
  assert.equal(p.monthlyPlan!.budget, 4000);
  p.budget = 1234.56;
  p.review!.active!.phase = "result";
  p.review!.active!.method = "trade";
  const restored = loadPortfolio({
    getItem: (key) =>
      key === STORAGE_KEY ? JSON.stringify(envelope(p)) : null,
  }).p;
  assert.deepEqual(beginReview(restored, now), restored);
  assert.equal(restored.budget, 1234.56);
  assert.equal(restored.review!.active!.method, "trade");
});
test("无需调整时保存真实快照与下一次日期，不将计划资金假记为成交", () => {
  const p = ready();
  p.budget = 1000;
  p.review!.rationale = "长期不用这笔钱";
  const next = finishReview(p, "unchanged", now);
  assert.equal(next.review!.active, undefined);
  assert.equal(next.review!.nextDate, "2027-04-30");
  assert.equal(next.review!.records[0].rationale, "长期不用这笔钱");
  assert.equal(next.review!.records[0].budget, 0);
  assert.equal(totals(next).invested, 100000);
  assert.equal(next.snapshot!.estimated, false);
  assert.throws(() => finishReview(next, "unchanged", now));
  assert.deepEqual(
    parseBackup(JSON.stringify(envelope(next))).portfolio,
    JSON.parse(JSON.stringify(next)),
  );
});
test("尚未核对、过期持仓、超出偏差和未来日期不会被误记为完成", () => {
  const p = beginReview(portfolio(), now);
  assert.throws(() => finishReview(p, "unchanged", now));
  const drift = ready(true);
  assert.throws(() => finishReview(drift, "unchanged", now));
  const stale = ready();
  stale.snapshot!.asOf = "2026-08-01";
  assert.throws(() => finishReview(stale, "unchanged", now));
  stale.snapshot!.asOf = "2026-11-01";
  assert.throws(() => finishReview(stale, "unchanged", now));
});
test("新增资金执行仅计一次，未完全纠偏时提前检查，并保留调整前后快照", () => {
  const p = ready(true);
  p.budget = 4000;
  const next = finishReview(p, "estimated", now);
  assert.equal(totals(next).invested, 104000);
  assert.equal(next.budget, 0);
  assert.equal(next.monthlyPlan!.budget, 4000);
  assert.equal(next.review!.nextDate, "2027-01-31");
  assert.equal(
    next.review!.records[0].before.assets.reduce((s, a) => s + a.value, 0),
    100000,
  );
  assert.equal(
    next.review!.records[0].after.assets.reduce((s, a) => s + a.value, 0),
    104000,
  );
  assert.equal(next.review!.records[0].after.estimated, true);
  assert.equal(next.review!.active, undefined);
});
test("买卖方案取整后资金守恒、交易成步长、尾差留现金，限购时不允许估算完成", () => {
  const p = ready(true);
  p.budget = 1234.56;
  p.rounding = 100;
  p.review!.active!.method = "trade";
  const rows = fullRebalance(p, rebalance(p));
  assert.equal(
    rows.reduce((s, r) => s + cents(r.after), 0),
    cents(101234.56),
  );
  assert.equal(
    rows.reduce((s, r) => s + cents(r.change), 0),
    0,
  );
  assert.ok(
    rows.every((r) => r.id === "cash" || cents(r.change) % 10000 === 0),
  );
  assert.ok(rows.find((r) => r.id === "cash")!.after >= 0);
  const next = finishReview(p, "estimated", now);
  assert.equal(cents(totals(next).invested), cents(101234.56));
  assert.equal(deviation(next).breached, false);
  assert.equal(next.review!.records[0].method, "trade");
  p.assets.find((a) => a.id === "bonds")!.monthlyLimit = 0;
  assert.throws(() => finishReview(p, "estimated", now));
});
test("真实结果不按计划再加一次资金，记录完成时保留实际市值", () => {
  const p = ready(true);
  p.budget = 4000;
  p.assets = p.assets.map((a, i) => ({
    ...a,
    value: [26000, 20800, 10400, 46800, 0][i],
  }));
  p.snapshot = { asOf: "2026-10-31", estimated: false };
  const next = finishReview(p, "actual", now);
  assert.equal(totals(next).invested, 104000);
  assert.equal(next.snapshot!.estimated, false);
  assert.equal(next.review!.records[0].outcome, "actual");
});
test("既有 v4 数据与备份原样恢复，缺少复查扩展时使用兼容默认值", () => {
  const p = portfolio();
  const restored = parseBackup(JSON.stringify(envelope(p))).portfolio;
  assert.deepEqual(restored, JSON.parse(JSON.stringify(p)));
  assert.equal(restored.review, undefined);
  assert.equal(reviewState(restored).intervalMonths, 6);
  const wrong = { ...envelope(p), schemaVersion: 5 };
  assert.throws(() => parseBackup(JSON.stringify(wrong)));
});
test("拒绝损坏的复查时间、快照、阶段、重复标识和超长历史", () => {
  const valid = ready();
  const mutate = (f: (p: Portfolio) => void) => {
    const p = structuredClone(valid);
    f(p);
    assert.throws(() => parseBackup(JSON.stringify(envelope(p))));
  };
  mutate((p) => (p.review!.nextDate = "2026-02-30"));
  mutate((p) => ((p.review!.intervalMonths as number) = 4));
  mutate((p) => (p.review!.rationale = "x".repeat(1001)));
  mutate((p) => ((p.review!.active!.phase as string) = "done"));
  mutate((p) => (p.review!.active!.before.assets[0].value = -1));
  mutate(
    (p) =>
      (p.review!.active!.before.assets[0].id =
        p.review!.active!.before.assets[1].id),
  );
  const done = finishReview(valid, "unchanged", now);
  done.review!.records = Array(31).fill(done.review!.records[0]);
  assert.throws(() => parseBackup(JSON.stringify(envelope(done))));
});
test("提醒文件包含跨月的完整日历事件，不含用户财务数据；方案文本反映所选取整", () => {
  const ics = calendarText("2027-12-31", now);
  assert.match(ics, /DTSTART;VALUE=DATE:20271231\r\nDTEND;VALUE=DATE:20280101/);
  assert.match(ics, /BEGIN:VALARM/);
  assert.doesNotMatch(ics, /预算|市值|买入|100000/);
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  const p = ready(true);
  p.budget = 4000;
  p.rounding = 100;
  const report = reportText(p, rebalance(p), "trade");
  assert.match(report, /交易金额步长：100 元/);
  assert.match(report, /卖出/);
  assert.match(report, /待投资余额/);
});
