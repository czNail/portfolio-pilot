import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { STORAGE_KEY, parseBackup } from "../src/storage/backup";

test("月预算与类别确认、无债券提示、固定定投、两种再平衡及预算隔离", async () => {
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
  const { createRoot } = await import("react-dom/client"),
    { default: App } = await import("../src/App");
  const container = dom.window.document.getElementById("root")!,
    root = createRoot(container);
  const flush = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
  };
  const button = (label: string) => {
    const el = [...container.querySelectorAll("button")].find(
      (b) =>
        b.textContent?.trim() === label ||
        b.textContent?.trim().startsWith(label),
    );
    assert.ok(el, `缺少按钮 ${label}`);
    return el;
  };
  const click = async (label: string) => {
    await act(async () => {
      button(label).click();
    });
  };
  const choice = async (name: string, index: number) => {
    await act(async () => {
      container
        .querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)
        [index].click();
    });
  };
  const input = async (label: string, value: string) => {
    const el = [...container.querySelectorAll("label")]
      .find((l) => l.textContent?.startsWith(label))
      ?.querySelector("input");
    assert.ok(el, label);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(el, value);
      el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  try {
    await act(async () => root.render(<App />));
    assert.match(container.textContent!, /每月定投/);
    assert.doesNotMatch(container.textContent!, /每月固定这样投/);
    await click("制定每月定投计划");
    assert.equal(button("继续，确定比例").disabled, true);
    await input("每月可定投金额", "4000");
    const bondChoice = [...container.querySelectorAll("label")]
      .find((l) => l.textContent?.trim() === "债券")!
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => bondChoice.click());
    assert.match(container.textContent!, /未选择债券/);
    await click("继续，确定比例");
    await choice("horizon", 3);
    await click("下一步");
    await choice("reserve", 2);
    await click("下一步");
    await choice("loss", 2);
    await click("下一步");
    await choice("reaction", 1);
    await click("查看比例与月投入");
    assert.match(container.textContent!, /照这个比例，每月这样投/);
    assert.match(container.textContent!, /当前没有债券配置/);
    assert.equal(button("确认每月定投计划").disabled, true);
    const ack = [...container.querySelectorAll("label")]
      .find((l) => l.textContent?.includes("我已了解风险不匹配提示"))!
      .querySelector<HTMLInputElement>("input")!;
    await act(async () => ack.click());
    await click("确认每月定投计划");
    await flush();
    const monthly = parseBackup(localStorage.getItem(STORAGE_KEY)!).portfolio;
    assert.equal(monthly.monthlyPlan!.budget, 4000);
    assert.deepEqual(monthly.monthlyPlan!.assetIds, ["us", "cn", "gold"]);
    assert.equal(monthly.assets.find((a) => a.id === "cash")!.target, 0);
    assert.equal(monthly.assets.find((a) => a.id === "bonds")!.target, 0);
    assert.match(container.textContent!, /每月固定这样投/);
    assert.equal(container.querySelectorAll(".monthly-amount-row").length, 3);
    const fixedAmounts = [
      ...container.querySelectorAll(".monthly-amount-row>strong"),
    ].map((e) => e.textContent);
    await click("我的持仓");
    await input("美股当前总市值", "50000");
    await input("A 股当前总市值", "15000");
    await input("黄金当前总市值", "10000");
    await input("债券当前总市值", "25000");
    await click("保存持仓");
    assert.match(container.textContent!, /持仓与目标差在哪里/);
    assert.match(container.textContent!, /本次暂停追加/);
    await input("本次用于再平衡的新增资金", "1000");
    await click("通过买卖一次调回");
    assert.match(
      container.querySelector(".trade-reference-list")!.textContent!,
      /卖出 ¥25,000.00/,
    );
    assert.match(
      container.querySelector(".trade-reference-list")!.textContent!,
      /买入/,
    );
    await click("用后续定投逐步调回");
    assert.match(container.textContent!, /理想情况下至少需新增/);
    await click("记录已按本次纠偏计划执行");
    await click("确认，更新估算持仓");
    await flush();
    const executed = parseBackup(localStorage.getItem(STORAGE_KEY)!).portfolio;
    assert.equal(executed.budget, 0);
    assert.equal(executed.monthlyPlan!.budget, 4000);
    assert.equal(executed.history!.length, 1);
    assert.equal(executed.snapshot!.estimated, true);
    await click("撤销");
    await flush();
    const reverted = parseBackup(localStorage.getItem(STORAGE_KEY)!).portfolio;
    assert.equal(reverted.budget, 1000);
    assert.equal(reverted.monthlyPlan!.budget, 4000);
    await click("定投计划");
    assert.deepEqual(
      [...container.querySelectorAll(".monthly-amount-row>strong")].map(
        (e) => e.textContent,
      ),
      fixedAmounts,
    );
    await click("调整预算与类别");
    await input("每月可定投金额", "8000");
    await click("取消");
    await flush();
    assert.equal(
      parseBackup(localStorage.getItem(STORAGE_KEY)!).portfolio.monthlyPlan!
        .budget,
      4000,
    );
    const saved = localStorage.getItem(STORAGE_KEY);
    await click("体验示例");
    await flush();
    assert.equal(localStorage.getItem(STORAGE_KEY), saved);
    await click("退出演示");
    await click("再平衡指导");
    await input("本次用于再平衡的新增资金", "abc");
    assert.match(container.textContent!, /本次预算需为非负金额/);
    assert.equal(
      [...container.querySelectorAll("button")].some(
        (b) => b.textContent?.trim() === "记录已按本次纠偏计划执行",
      ),
      false,
    );
    await input("本次用于再平衡的新增资金", "1000");
    await click("压力测算");
    await input("美股假设跌幅", "abc");
    assert.match(container.textContent!, /美股假设跌幅需为/);
    await input("美股假设跌幅", "60");
    assert.match(container.textContent!, /投资组合的情景损失/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
