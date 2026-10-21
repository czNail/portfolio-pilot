import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { STORAGE_KEY, parseBackup } from "../src/storage/backup";

test("首次评估、更新持仓、自动计划、执行与撤销，以及隔离演示数据", async () => {
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
      (b) => b.textContent?.trim() === label,
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
    await act(async () => {
      root.render(<App />);
    });
    assert.match(container.textContent!, /先定好比例/);
    assert.doesNotMatch(container.textContent!, /本次安排|记录已按计划执行/);
    await click("确定我的长期策略");
    assert.equal(button("下一步").disabled, true);
    await choice("horizon", 3);
    await click("下一步");
    await choice("reserve", 2);
    await click("下一步");
    await choice("loss", 2);
    await click("下一步");
    await choice("reaction", 1);
    await click("查看建议比例");
    assert.match(container.textContent!, /建议采用平衡型/);
    assert.doesNotMatch(container.textContent!, /记录已按计划执行/);
    await click("确认并使用策略");
    await flush();
    assert.ok(
      parseBackup(localStorage.getItem(STORAGE_KEY)!).portfolio.strategy,
    );
    assert.match(container.textContent!, /输入预算，查看这次买什么/);
    await click("我的持仓");
    await input("美股当前总市值", "50000");
    await input("A 股当前总市值", "15000");
    await input("黄金当前总市值", "10000");
    await input("债券当前总市值", "25000");
    await click("保存持仓");
    await click("¥4,000");
    assert.ok(container.querySelectorAll(".buy-row").length > 0);
    assert.match(container.textContent!, /投入后仍有资产偏离目标/);
    await click("记录已按计划执行");
    assert.ok(container.querySelector("dialog")?.open);
    await click("确认，更新估算持仓");
    await flush();
    const executed = parseBackup(localStorage.getItem(STORAGE_KEY)!).portfolio;
    assert.equal(executed.budget, 0);
    assert.equal(executed.history!.length, 1);
    assert.equal(executed.snapshot!.estimated, true);
    assert.match(container.textContent!, /本次执行已记录/);
    await click("撤销");
    await flush();
    const reverted = parseBackup(localStorage.getItem(STORAGE_KEY)!).portfolio;
    assert.equal(reverted.budget, 4000);
    assert.equal(reverted.history, undefined);
    const saved = localStorage.getItem(STORAGE_KEY);
    await click("体验示例");
    await flush();
    assert.equal(localStorage.getItem(STORAGE_KEY), saved);
    assert.match(container.textContent!, /正在体验虚构示例/);
    await click("退出演示");
    assert.match(container.textContent!, /已核对市值/);
    await click("长期策略");
    await click("微调目标比例");
    await click("暂不修改");
    await flush();
    assert.equal(
      parseBackup(localStorage.getItem(STORAGE_KEY)!).portfolio.strategy!
        .revision,
      1,
    );
    await input("本次投入金额", "abc");
    assert.match(container.textContent!, /本次预算需为非负金额/);
    assert.equal(
      [...container.querySelectorAll("button")].some(
        (b) => b.textContent === "记录已按计划执行",
      ),
      false,
    );
    await input("本次投入金额", "4000");
    await click("压力测算");
    await input("美股假设跌幅", "abc");
    assert.match(container.textContent!, /美股假设跌幅需为/);
    assert.ok(
      [...container.querySelectorAll("label")].some((l) =>
        l.textContent?.startsWith("美股假设跌幅"),
      ),
    );
    await input("美股假设跌幅", "60");
    assert.match(container.textContent!, /投资组合的情景损失/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
