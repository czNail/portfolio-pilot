import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { emptyPortfolio, type Portfolio } from "../src/domain/model";
import { confirmStrategy } from "../src/domain/strategy";
import { reviewState, localDate, addMonths } from "../src/domain/review";
import {
  STORAGE_KEY,
  RESTORE_POINT_KEY,
  envelope,
  parseBackup,
} from "../src/storage/backup";

function fixture(drift = false): Portfolio {
  const p = confirmStrategy(
    emptyPortfolio(),
    [25, 20, 10, 45, 0],
    undefined,
    "自己的配置",
    true,
  );
  p.monthlyPlan = { budget: 4000, assetIds: ["us", "cn", "gold", "bonds"] };
  p.snapshot = { asOf: localDate(), estimated: false };
  p.assets = p.assets.map((a, i) => ({
    ...a,
    value: (drift
      ? [50000, 15000, 10000, 25000, 0]
      : [25000, 20000, 10000, 45000, 0])[i],
  }));
  p.review = {
    ...reviewState(p),
    nextDate: "2026-01-01",
    rationale: "长期积累",
  };
  return p;
}
async function mount(p: Portfolio) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "https://cznail.github.io/portfolio-pilot/" },
  );
  for (const key of [
    "window",
    "document",
    "localStorage",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLDialogElement",
    "Event",
    "MouseEvent",
    "navigator",
  ])
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: (dom.window as any)[key],
    });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  dom.window.scrollTo = () => {};
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  dom.window.HTMLAnchorElement.prototype.click = function () {};
  localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope(p)));
  const { createRoot } = await import("react-dom/client"),
    { default: App } = await import("../src/App");
  const container = dom.window.document.getElementById("root")!,
    root = createRoot(container);
  const flush = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 280));
    });
  };
  const click = async (label: string) => {
    const buttons = [...container.querySelectorAll("button")];
    const button =
      buttons.find(
        (b) =>
          b.textContent?.trim() === label ||
          b.getAttribute("aria-label") === label,
      ) ?? buttons.find((b) => b.textContent?.trim().startsWith(label));
    assert.ok(button, `缺少按钮 ${label}`);
    assert.equal(button.disabled, false, `按钮不可用 ${label}`);
    await act(async () => button.click());
  };
  const input = async (label: string, value: string) => {
    const el = [...container.querySelectorAll("label")]
      .find((l) => l.textContent?.startsWith(label))
      ?.querySelector("input");
    assert.ok(el, label);
    await act(async () => {
      el.focus();
      Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(el, value);
      el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  const read = () => parseBackup(localStorage.getItem(STORAGE_KEY)!).portfolio;
  const cleanup = async () => {
    await act(async () => root.unmount());
    dom.window.close();
  };
  await act(async () => root.render(<App />));
  return { dom, container, root, flush, click, input, read, cleanup };
}

test("到期复查从市值核对开始，无需调整可直接结束，安排下一次并提示备份", async () => {
  const ui = await mount(fixture());
  try {
    assert.match(ui.container.textContent!, /到了复查时间/);
    await ui.click("开始本次复查");
    assert.match(ui.container.textContent!, /核对最新市值/);
    await ui.click("保存持仓");
    assert.match(ui.container.textContent!, /过去几个月的定投已计入/);
    await ui.click("查看本次建议");
    assert.match(ui.container.textContent!, /目前无需专门再平衡/);
    await ui.click("本次无需调整，结束复查");
    await ui.flush();
    const p = ui.read();
    assert.equal(p.review!.records.length, 1);
    assert.equal(p.review!.records[0].outcome, "unchanged");
    assert.equal(p.review!.nextDate, addMonths(localDate(), 6));
    assert.equal(p.review!.active, undefined);
    assert.match(ui.container.textContent!, /备份本次结果/);
    await ui.click("备份本次结果");
    await ui.flush();
    assert.ok(ui.read().review!.lastExportedAt);
  } finally {
    await ui.cleanup();
  }
});

test("暂存后重载能继续买卖方案，复制有降级路径，执行后保存快照且可以撤销", async () => {
  let ui = await mount(fixture(true));
  let pending: Portfolio;
  try {
    await ui.click("开始本次复查");
    await ui.click("保存持仓");
    await ui.input("本次用于再平衡的新增资金", "4000");
    await ui.click("查看本次建议");
    await ui.click("通过买卖一次调回");
    await ui.click("复制本次方案");
    assert.ok(
      ui.container.querySelector('textarea[aria-label="本次方案文本"]'),
    );
    await ui.click("完成");
    await ui.click("尚未操作，保存方案下次继续");
    await ui.flush();
    pending = ui.read();
    assert.equal(pending.review!.records.length, 0);
    assert.equal(pending.review!.active!.method, "trade");
    assert.equal(pending.budget, 4000);
    assert.match(ui.container.textContent!, /接着完成上次的复查/);
  } finally {
    await ui.cleanup();
  }
  ui = await mount(pending!);
  try {
    await ui.click("继续本次复查");
    assert.match(
      ui.container.querySelector(".trade-reference-list")!.textContent!,
      /卖出/,
    );
    await ui.click("记录已按买卖方案执行");
    await ui.click("确认，更新估算持仓");
    await ui.flush();
    const completed = ui.read();
    assert.equal(completed.review!.records[0].method, "trade");
    assert.equal(completed.snapshot!.estimated, true);
    assert.equal(
      completed.assets.reduce((s, a) => s + a.value, 0),
      104000,
    );
    assert.equal(completed.monthlyPlan!.budget, 4000);
    await ui.click("撤销");
    await ui.flush();
    assert.equal(ui.read().review!.active!.method, "trade");
    assert.equal(ui.read().budget, 4000);
  } finally {
    await ui.cleanup();
  }
});

test("备份导入先预览且不写入，确认后可撤销恢复，旧 v4 数据不丢失", async () => {
  const original = fixture(),
    replacement = fixture(true);
  delete replacement.review;
  replacement.monthlyPlan!.budget = 8000;
  const ui = await mount(original);
  try {
    await ui.flush();
    await ui.click("备份与恢复");
    const input =
      ui.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const text = JSON.stringify(envelope(replacement));
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{ size: text.length, text: async () => text }],
    });
    await act(async () => {
      input.dispatchEvent(new ui.dom.window.Event("change", { bubbles: true }));
    });
    assert.match(ui.container.textContent!, /预览待恢复的备份/);
    assert.match(
      ui.container.querySelector(".backup-preview")!.textContent!,
      /8,000/,
    );
    assert.equal(ui.read().monthlyPlan!.budget, 4000);
    await ui.click("确认恢复并保留原数据");
    await ui.flush();
    assert.equal(ui.read().monthlyPlan!.budget, 8000);
    assert.equal(
      parseBackup(localStorage.getItem(RESTORE_POINT_KEY)!).portfolio
        .monthlyPlan!.budget,
      4000,
    );
    await ui.click("备份与恢复");
    await ui.click("撤销上次恢复");
    assert.match(ui.container.textContent!, /预览待恢复/);
    await ui.click("确认恢复并保留原数据");
    await ui.flush();
    assert.equal(ui.read().monthlyPlan!.budget, 4000);
    assert.equal(ui.read().review!.rationale, "长期积累");
  } finally {
    await ui.cleanup();
  }
});

test("完成实际调整后录入市值结束复查，保存真实结果且不重复追加资金", async () => {
  const ui = await mount(fixture(true));
  try {
    await ui.click("开始本次复查");
    await ui.click("保存持仓");
    await ui.input("本次用于再平衡的新增资金", "4000");
    await ui.click("查看本次建议");
    await ui.click("已完成调整，填写实际结果");
    await ui.input("美股当前总市值", "26000");
    await ui.input("A 股当前总市值", "20800");
    await ui.input("黄金当前总市值", "10400");
    await ui.input("债券当前总市值", "46800");
    await ui.click("保存持仓");
    await ui.flush();
    const p = ui.read();
    assert.equal(
      p.assets.reduce((s, a) => s + a.value, 0),
      104000,
    );
    assert.equal(p.snapshot!.estimated, false);
    assert.equal(p.review!.records[0].outcome, "actual");
    assert.equal(p.review!.records[0].before.assets[0].value, 50000);
    assert.equal(p.review!.records[0].after.assets[0].value, 26000);
    assert.equal(p.review!.active, undefined);
    await ui.click("体验示例");
    await ui.click("正常复查：继续原计划");
    await ui.click("备份与恢复");
    const reset = [...ui.container.querySelectorAll("button")].find(
      (b) => b.textContent === "清空当前配置",
    )!;
    assert.equal(reset.disabled, true);
    assert.equal(ui.read().review!.records[0].outcome, "actual");
  } finally {
    await ui.cleanup();
  }
});

test("加法输入、每日限购、临时计划保存重载和结束，不把计划假记为成交", async () => {
  const original = fixture(true);
  let ui = await mount(original),
    saved: Portfolio;
  try {
    await ui.input("每个扣款日总预算", "100+50.50");
    assert.match(ui.container.textContent!, /合计 ¥150.50/);
    await ui.input("每个扣款日总预算", "100+");
    const save = [...ui.container.querySelectorAll("button")].find(
      (b) => b.textContent === "保存每日定投设置",
    )!;
    assert.equal(save.disabled, true);
    await ui.input("每个扣款日总预算", "100+50.50");
    await ui.input("美股单日可买上限", "10+5");
    await ui.click("保存每日定投设置");
    await ui.flush();
    assert.equal(ui.read().dailySettings!.budget, 150.5);
    assert.equal(ui.read().dailySettings!.rules.us.dailyLimit, 15);
    await ui.click("开始本次复查");
    await ui.input("A 股当前总市值", "10000+5000");
    await ui.click("保存持仓");
    await ui.click("查看本次建议");
    assert.match(ui.container.textContent!, /暂停 \/ 提高定投/);
    await ui.input("临时每日总预算", "200+50");
    await ui.click("保存临时计划，回首页");
    await ui.flush();
    saved = ui.read();
    assert.equal(saved.adjustment!.dailyBudget, 250);
    assert.equal(saved.adjustment!.kind, "recurring");
    assert.equal(saved.review!.active, undefined);
    assert.equal(saved.assets[0].value, original.assets[0].value);
    assert.equal(saved.assets[1].value, 15000);
    assert.equal(saved.dailySettings!.budget, 150.5);
    assert.match(ui.container.textContent!, /正在执行的临时调整/);
    assert.match(ui.container.textContent!, /网页关闭后不会提醒/);
    assert.doesNotMatch(ui.container.textContent!, /持仓、比例或设置已变化/);
  } finally {
    await ui.cleanup();
  }
  ui = await mount(saved!);
  try {
    assert.match(ui.container.textContent!, /正在执行的临时调整/);
    await ui.click("结束临时计划");
    await ui.click("已了解，结束临时计划");
    await ui.flush();
    assert.equal(ui.read().adjustment, undefined);
    assert.equal(ui.read().dailySettings!.budget, 150.5);
    assert.equal(ui.read().assets[0].value, original.assets[0].value);
  } finally {
    await ui.cleanup();
  }
});

test("按每日预算直接设置，确认金额保留到首页，不再次换算", async () => {
  const ui = await mount(fixture());
  try {
    await ui.click("修改目标比例");
    await ui.click("修改预算或类别");
    await ui.click("按每日预算填写");
    await ui.input("每日可定投金额", "100+50");
    await ui.click("我已有目标比例，直接设置");
    assert.match(ui.container.textContent!, /照这个比例，每日这样投/);
    await ui.click("确认每日定投计划");
    await ui.flush();
    assert.equal(ui.read().dailySettings!.budget, 150);
    assert.equal(ui.read().monthlyPlan!.budget, 3150);
    assert.match(ui.container.textContent!, /每个扣款日预算/);
    assert.doesNotMatch(ui.container.textContent!, /尚未保存为每日设置/);
  } finally {
    await ui.cleanup();
  }
});
