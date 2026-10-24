import { useEffect, useMemo, useRef, useState } from "react";
import {
  emptyPortfolio,
  demoPortfolio,
  validate,
  CASH_ID,
  type Portfolio,
} from "./domain/model";
import { rebalance, stress } from "./domain/rebalance";
import {
  strategyConfirmed,
  confirmStrategy,
  type RiskProfile,
} from "./domain/strategy";

import { loadPortfolio } from "./storage/session";
import { STORAGE_KEY, envelope, downloadText } from "./storage/backup";
import { Icon, Panel, Modal, colors, money, pct } from "./components";
import { ShareSlider } from "./AllocationControls";
import StrategyEditor from "./StrategyEditor";
import HoldingsEditor from "./HoldingsEditor";
import MonthlyDashboard from "./MonthlyDashboard";
import { monthlyReady } from "./domain/monthly";
import ReviewHome from "./ReviewHome";
import ReviewWorkspace from "./ReviewWorkspace";
import BackupWorkspace from "./BackupWorkspace";
import DailyWorkspace, { ActiveAdjustment } from "./DailyWorkspace";
import {
  beginReview,
  finishReview,
  reviewState,
  capture,
  localDate,
  type ReviewRecord,
} from "./domain/review";
import { fullRebalance } from "./domain/planning";

type Page = "monthly" | "plan" | "holdings" | "strategy" | "risk" | "backup";
function boot() {
  try {
    return loadPortfolio(localStorage);
  } catch {
    return loadPortfolio({
      getItem: () => {
        throw new Error("unavailable");
      },
    });
  }
}
export default function App() {
  const [initial] = useState(boot),
    [p, setP] = useState(initial.p),
    [page, setPage] = useState<Page>("monthly");
  const [blocked, setBlocked] = useState(initial.blocked),
    [recovery, setRecovery] = useState(initial.raw),
    [notice, setNotice] = useState(initial.notice);
  const [savedAt, setSavedAt] = useState(initial.savedAt),
    [saveError, setSaveError] = useState(""),
    [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(""),
    [undo, setUndo] = useState<Portfolio | null>(null),
    [beforeDemo, setBeforeDemo] = useState<Portfolio | null>(null);
  const [editorSetup, setEditorSetup] = useState(false);
  const [demoPicker, setDemoPicker] = useState(false);
  const [executing, setExecuting] = useState(false),
    [riskAfter, setRiskAfter] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    executionLock = useRef(false);
  const signature = JSON.stringify(p),
    issues = validate(p),
    valid = issues.length === 0;
  const plan = useMemo(() => {
    if (!monthlyReady(p) || validate(p, { forPlan: true }).length) return null;
    return rebalance(p);
  }, [signature]);
  const riskPlan = useMemo(() => {
    if (!plan || p.review?.active?.method !== "trade") return plan;
    const trades = fullRebalance(p, plan);
    return {
      ...plan,
      rows: plan.rows.map((row) => ({
        ...row,
        after: trades.find((r) => r.id === row.id)!.after,
      })),
    };
  }, [plan, p.review?.active?.method]);
  const risk = valid
    ? stress(p, riskAfter && riskPlan ? riskPlan : undefined)
    : null;
  const portfolioRisk = risk
    ? (() => {
        const rows = risk.rows.filter((r) => r.id !== "reserve"),
          value = rows.reduce((s, r) => s + r.value, 0),
          loss = rows.reduce((s, r) => s + r.loss, 0);
        return { value, loss, rate: value ? (loss / value) * 100 : 0 };
      })()
    : null;
  useEffect(() => {
    if (blocked || !valid || p.demo) {
      setSaving(false);
      return;
    }
    setSaving(true);
    const timer = setTimeout(() => {
      try {
        const e = envelope(p);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(e));
        setSavedAt(e.savedAt);
        setSaveError("");
      } catch {
        setSaveError("自动保存暂不可用，请导出备份。");
      }
      setSaving(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [signature, blocked, valid]);
  useEffect(() => {
    if (!message || undo) return;
    const t = setTimeout(() => setMessage(""), 6000);
    return () => clearTimeout(t);
  }, [message, undo]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) {
        setBlocked(true);
        setRecovery(e.newValue || "");
        setSaveError(
          "其他标签页修改或清除了数据。本页已暂停保存，请先导出备份，再刷新。",
        );
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!p.demo && (!valid || saving || saveError || blocked)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [valid, saving, saveError, blocked, p.demo]);
  const go = (next: Page) => {
    setPage(next);
    setExecuting(false);
    window.scrollTo({ top: 0, behavior: "instant" });
    setTimeout(() => heading.current?.focus(), 0);
  };
  const apply = (patch: Partial<Portfolio>) => {
    setUndo(null);
    setP((prev) => ({ ...prev, ...patch }));
  };
  const exportData = () => {
    if (!valid) {
      setMessage("请先修正输入，再导出备份。");
      return;
    }
    const next = monthlyReady(p)
      ? {
          ...p,
          review: {
            ...reviewState(p),
            lastExportedAt: new Date().toISOString(),
          },
        }
      : p;
    try {
      downloadText(
        JSON.stringify(envelope(next), null, 2),
        `portfolio-pilot-${localDate()}.json`,
      );
      setP(next);
      setMessage("备份已导出。");
    } catch {
      setMessage("备份未能导出，请重试。");
    }
  };
  const replaceData = (next: Portfolio) => {
    setP(next);
    setUndo(null);
    setBeforeDemo(null);
    setBlocked(false);
    setSaveError("");
    setNotice("");
    go("monthly");
  };
  const openReview = () => {
    if (!monthlyReady(p)) {
      setEditorSetup(true);
      go("strategy");
      return;
    }
    setP(beginReview(p));
    setUndo(null);
    go("plan");
  };
  const startDemo = (kind: "normal" | "drift" | "limited") => {
    const profile: RiskProfile = {
      horizon: "over7",
      reserve: "over6",
      loss: 50,
      reaction: "hold",
      region: "equal",
    };
    const base = confirmStrategy(
      demoPortfolio(),
      [25, 20, 10, 45, 0],
      profile,
      "长期配置示例",
      true,
    );
    const values =
      kind === "normal"
        ? [25000, 20000, 10000, 45000, 0]
        : [50000, 15000, 10000, 25000, 0];
    const demo: Portfolio = {
      ...base,
      monthlyPlan: { budget: 4000, assetIds: ["us", "cn", "gold", "bonds"] },
      assets: base.assets.map((a, i) => ({
        ...a,
        value: values[i],
        monthlyLimit: kind === "limited" && a.id === "bonds" ? 0 : null,
      })),
      snapshot: { asOf: localDate(), estimated: false },
    };
    demo.review = {
      ...reviewState(demo),
      nextDate: localDate(),
      rationale: "这笔钱用于长期积累；先确认生活安全垫，再按约定比例持续投入。",
    };
    setBeforeDemo(p);
    setP(demo);
    setUndo(null);
    setDemoPicker(false);
    go("monthly");
  };
  const completeReview = (outcome: ReviewRecord["outcome"], input = p) => {
    try {
      const next = finishReview(input, outcome);
      setUndo(p);
      setP(next);
      go("monthly");
      setMessage("本次复查已保存，下次日期已安排。可以导出一份备份。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "记录失败。");
    }
  };
  const finishExecution = () => {
    if (!plan || blocked || executionLock.current) return;
    executionLock.current = true;
    completeReview("estimated");
    setExecuting(false);
    setTimeout(() => {
      executionLock.current = false;
    }, 0);
  };
  const pageTitles: Record<Page, [string, string]> = {
    monthly: [
      "每天投多少，这里看清楚",
      "在支付宝设置定投；需要调整时，选择追加、卖出或修改每日投入。",
    ],
    plan: [
      "本次复查，知道该怎样调整",
      "核对市值、确认本次资金，按清单完成调整。",
    ],
    holdings: ["更新我的持仓", "按资产大类记下市值，计划会据此重新计算。"],
    strategy: [
      "制定每月定投计划",
      "先确定预算与类别，再结合风险偏好确认比例和每月金额。",
    ],
    risk: ["看看组合能承受什么", "分别查看投资组合与包含备用金的全部资产。"],
    backup: [
      "数据在自己手里",
      "持仓、策略和执行记录保存在当前浏览器，也可以备份带走。",
    ],
  };
  const monthlyDashboard = (
    <MonthlyDashboard
      p={p}
      onEdit={(setup) => {
        setEditorSetup(setup);
        go("strategy");
      }}
      onRebalance={openReview}
      onHoldings={() => go("holdings")}
    />
  );
  return (
    <div className="pilot-app">
      <a className="skip" href="#main">
        跳到正文
      </a>
      <header className="app-header">
        <div className="header-inner">
          <a
            className="logo"
            href="/portfolio-pilot/"
            onClick={(e) => {
              e.preventDefault();
              go("monthly");
            }}
          >
            <span className="logo-mark">
              P<span>.</span>
            </span>
            <span>
              Portfolio Pilot<small>仓位助手</small>
            </span>
          </a>
          <nav aria-label="主要功能">
            {(
              [
                ["monthly", "定投计划"],
                ["plan", "再平衡指导"],
                ["holdings", "我的持仓"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={page === id ? "selected" : ""}
                aria-current={page === id ? "page" : undefined}
                onClick={() => (id === "plan" ? openReview() : go(id))}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="header-actions">
            <span
              className={`save-status ${saveError || blocked ? "unsaved" : ""}`}
            >
              <i />
              {p.demo
                ? "演示模式"
                : blocked
                  ? "保存已暂停"
                  : saveError
                    ? "未保存"
                    : saving
                      ? "保存中…"
                      : savedAt
                        ? "已自动保存"
                        : "仅存于本机"}
            </span>
            <button
              className={`icon-btn ${page === "backup" ? "active" : ""}`}
              aria-label="备份与恢复"
              onClick={() => go("backup")}
            >
              <Icon name="data" />
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="main-wrap">
        <div className="page-title">
          <div>
            <p className="eyebrow">A LITTLE PLAN, A CLEARER PORTFOLIO</p>
            <h1 ref={heading} tabIndex={-1}>
              {pageTitles[page][0]}
            </h1>
            <p>{pageTitles[page][1]}</p>
          </div>
          {page === "monthly" && !p.demo && (
            <button className="text-button" onClick={() => setDemoPicker(true)}>
              体验示例
              <Icon name="arrow" size={16} />
            </button>
          )}
        </div>
        {p.demo && (
          <div className="notice demo-notice">
            <Icon name="info" />
            <span>正在体验虚构示例。这里的修改不会覆盖你的已保存数据。</span>
            <button
              className="text-button"
              onClick={() => {
                setP(beforeDemo ?? emptyPortfolio());
                setBeforeDemo(null);
                setUndo(null);
                go("monthly");
              }}
            >
              退出演示
            </button>
          </div>
        )}
        {notice && !blocked && (
          <div className="notice">
            <Icon name="info" />
            <span>{notice}</span>
            <button
              className="icon-btn"
              aria-label="关闭提示"
              onClick={() => setNotice("")}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {(saveError || blocked) && (
          <div className="notice warning" role="alert">
            <Icon name="info" />
            <span>{saveError || initial.notice}</span>
            <button className="text-button" onClick={() => go("backup")}>
              备份与恢复
            </button>
          </div>
        )}
        {!valid && (
          <div className="notice warning" role="alert">
            <Icon name="info" />
            <span>{issues.join(" ")}</span>
          </div>
        )}
        {page === "strategy" && (
          <StrategyEditor
            key={p.strategy?.confirmedAt ?? "new"}
            p={p}
            startAtSetup={editorSetup}
            onSave={(next) => {
              setP({
                ...next,
                review: { ...reviewState(next), active: undefined },
              });
              setUndo(null);
              go("monthly");
              setMessage("长期计划已确认，下一次复查时间已安排。");
            }}
            onCancel={() => go("monthly")}
          />
        )}
        {page === "holdings" && (
          <HoldingsEditor
            p={p}
            onSave={(next) => {
              if (monthlyReady(next)) {
                const reviewing = beginReview({
                  ...next,
                  review: { ...reviewState(next), active: undefined },
                });
                setP({
                  ...reviewing,
                  review: {
                    ...reviewing.review!,
                    active: {
                      ...reviewing.review!.active!,
                      phase: "funding",
                      before: capture(next),
                    },
                  },
                });
              } else setP(next);
              setUndo(null);
              go("plan");
              setMessage(
                strategyConfirmed(next)
                  ? "持仓已更新，投入计划已重新计算。"
                  : "持仓已保存，请确认长期目标比例。",
              );
            }}
            onCancel={() => go("plan")}
          />
        )}
        {page === "monthly" && (
          <>
            {monthlyReady(p) && (
              <>
                {p.adjustment && (
                  <ActiveAdjustment
                    p={p}
                    onChange={setP}
                    onReview={openReview}
                  />
                )}
                <DailyWorkspace
                  key={p.strategy?.confirmedAt}
                  p={p}
                  onChange={(next) => {
                    setP(next);
                    setUndo(null);
                  }}
                  onEdit={() => {
                    setEditorSetup(false);
                    go("strategy");
                  }}
                  onReview={openReview}
                />
              </>
            )}
            {monthlyReady(p) && (
              <ReviewHome
                p={p}
                onChange={(next) => {
                  setP(next);
                  setUndo(null);
                }}
                onStart={openReview}
                onExport={exportData}
                onEdit={() => {
                  setEditorSetup(false);
                  go("strategy");
                }}
              />
            )}
            {monthlyReady(p) ? (
              <details className="long-term-plan">
                <summary>原月预算与配置详情</summary>
                {monthlyDashboard}
              </details>
            ) : (
              monthlyDashboard
            )}
          </>
        )}
        {page === "plan" &&
          (p.review?.active ? (
            <ReviewWorkspace
              p={p}
              onChange={(next) => {
                setP(next);
                setUndo(null);
              }}
              onPause={() => go("monthly")}
              onSaveAdjustment={(next) => {
                setP(next);
                setUndo(p);
                go("monthly");
                setMessage(
                  "临时计划已保存。请在支付宝修改设置，并在手机日历添加复查提醒。",
                );
              }}
              onComplete={completeReview}
              onEstimate={() => {
                executionLock.current = false;
                setExecuting(true);
              }}
              onEdit={() => {
                setEditorSetup(true);
                go("strategy");
              }}
              blocked={blocked}
            />
          ) : (
            <Panel title="开始一次复查">
              <p>先核对最新持仓，再计算本次调整金额。</p>
              <button className="btn primary" onClick={openReview}>
                开始本次复查
              </button>
            </Panel>
          ))}
        {page === "risk" && (
          <>
            <div className="risk-toolbar">
              <div className="segmented">
                <button
                  className={!riskAfter ? "selected" : ""}
                  onClick={() => setRiskAfter(false)}
                >
                  当前持仓
                </button>
                <button
                  className={riskAfter ? "selected" : ""}
                  disabled={!plan}
                  onClick={() => setRiskAfter(true)}
                >
                  本次计划后
                </button>
              </div>
              <button className="text-button" onClick={() => go("plan")}>
                返回再平衡指导
                <Icon name="arrow" size={16} />
              </button>
            </div>
            {risk && portfolioRisk && (
              <div className="risk-summary-grid">
                <Panel className="scenario-card" title="投资组合的情景损失">
                  <strong className="scenario-amount">
                    −{money(portfolioRisk.loss)}
                  </strong>
                  <span>占组合 {pct(portfolioRisk.rate)}</span>
                  <p className="field-note">
                    以参与配置的 {money(portfolioRisk.value)} 为分母。
                  </p>
                </Panel>
                <Panel title="包含备用金的全部资产">
                  <strong className="scenario-amount">
                    −{money(risk.loss)}
                  </strong>
                  <span>占全部资产 {pct(risk.rate)}</span>
                  <p className="field-note">
                    以全部资产 {money(risk.total)}{" "}
                    为分母。备用金会降低此比例，不改变投资组合自身的风险。
                  </p>
                </Panel>
              </div>
            )}
            <Panel
              title="假设这些资产同时下跌"
              description="修改假设只更新压力测算，不会改变已确认的目标。实际损失可能更大。"
            >
              <div className="shock-list">
                {p.assets.map((a, i) => (
                  <div className="shock-row" key={a.id}>
                    <span className="asset-name">
                      <i style={{ background: colors[i % colors.length] }} />
                      {a.name}
                    </span>
                    <ShareSlider
                      name={a.name}
                      label="假设跌幅"
                      value={a.shock}
                      color={colors[i % colors.length]}
                      onChange={(v) =>
                        apply({
                          assets: p.assets.map((x) =>
                            x.id === a.id
                              ? { ...x, shock: Math.max(0, Math.min(100, v)) }
                              : x,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
                {p.reserve > 0 && (
                  <div className="shock-row">
                    <span>备用金</span>
                    <ShareSlider
                      name="备用金"
                      label="假设跌幅"
                      value={p.reserveShock}
                      onChange={(v) =>
                        apply({ reserveShock: Math.max(0, Math.min(100, v)) })
                      }
                    />
                  </div>
                )}
              </div>
              <p className="field-note">
                这是静态压力情景，不是未来收益或最大回撤预测。计划只反映已录入的市值与约束。
              </p>
            </Panel>
          </>
        )}
        {page === "backup" && (
          <BackupWorkspace
            p={p}
            savedAt={savedAt}
            blocked={blocked}
            recovery={recovery}
            onExport={exportData}
            onRestore={(next) => {
              replaceData(next);
              setMessage("已恢复备份；恢复前的数据可在备份页找回。");
            }}
            onMessage={setMessage}
            onReset={() => {
              if (window.confirm("清空当前持仓、策略和复查记录？")) {
                replaceData(emptyPortfolio());
                setMessage("已重新开始。");
              }
            }}
          />
        )}
        <footer className="app-footer">
          <span>Portfolio Pilot · 木匠钉子 / Neil Chen</span>
          <div>
            <button onClick={() => go("risk")}>压力测算</button>
            <button onClick={() => go("backup")}>备份</button>
            <a
              href="https://github.com/czNail/portfolio-pilot"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
              <Icon name="external" size={13} />
            </a>
          </div>
        </footer>
      </main>
      {demoPicker && (
        <Modal title="选择一个复查示例" onClose={() => setDemoPicker(false)}>
          <div className="demo-options">
            <button className="btn" onClick={() => startDemo("normal")}>
              正常复查：继续原计划
            </button>
            <button className="btn" onClick={() => startDemo("drift")}>
              持仓偏离：比较调整方案
            </button>
            <button className="btn" onClick={() => startDemo("limited")}>
              额度受限：查看剩余资金
            </button>
          </div>
          <p className="field-note">示例只在内存中运行，不覆盖你的数据。</p>
        </Modal>
      )}
      {executing && plan && (
        <Modal
          title="已经按这份计划完成操作？"
          onClose={() => setExecuting(false)}
        >
          <p className="body-copy">
            确认后保存本次复查与估算持仓，安排下一次检查。本次新增资金清零，长期月预算保持不变。
          </p>
          <div className="execution-confirm-list">
            {(p.review?.active?.method === "trade"
              ? fullRebalance(p, plan)
                  .filter((r) => r.id !== CASH_ID && r.change !== 0)
                  .map((r) => ({ id: r.id, name: r.name, amount: r.change }))
              : plan.rows
                  .filter((r) => r.buy > 0 && r.id !== CASH_ID)
                  .map((r) => ({
                    id: r.id,
                    name: p.assets.find((a) => a.id === r.id)!.name,
                    amount: r.buy,
                  }))
            ).map((r) => (
              <div key={r.id}>
                <span>{r.name}</span>
                <strong>
                  {r.amount < 0 ? "卖出 " : "买入 "}
                  {money(Math.abs(r.amount))}
                </strong>
              </div>
            ))}
          </div>
          <p className="field-note">
            实际金额与计划不同，请取消并直接更新持仓。此操作不会向任何交易平台下单。
          </p>
          <div className="editor-actions">
            <button className="btn" onClick={() => setExecuting(false)}>
              还没完成
            </button>
            <button
              className="btn primary"
              disabled={blocked}
              onClick={finishExecution}
            >
              确认，更新估算持仓
            </button>
          </div>
        </Modal>
      )}
      {message && (
        <div className="toast" role="status">
          <Icon name="info" size={18} />
          <span>{message}</span>
          {undo && (
            <button
              className="undo-button"
              onClick={() => {
                setP(undo);
                setUndo(null);
                setMessage("已撤销，恢复本次复查前的持仓、资金与安排。");
              }}
            >
              撤销
            </button>
          )}
          <button
            className="icon-btn"
            aria-label="关闭提示"
            onClick={() => {
              setMessage("");
              setUndo(null);
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
