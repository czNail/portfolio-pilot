import { useEffect, useMemo, useRef, useState } from "react";
import {
  emptyPortfolio,
  demoPortfolio,
  totals,
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
import { executePlan, snapshotAge } from "./domain/planning";
import { loadPortfolio } from "./storage/session";
import {
  STORAGE_KEY,
  MAX_BACKUP_BYTES,
  envelope,
  parseBackup,
  downloadText,
} from "./storage/backup";
import { Icon, Panel, Modal, colors, money, pct } from "./components";
import { ShareSlider } from "./AllocationControls";
import StrategyEditor from "./StrategyEditor";
import HoldingsEditor from "./HoldingsEditor";
import MonthlyDashboard from "./MonthlyDashboard";
import RebalanceDashboard from "./RebalanceDashboard";
import { monthlyReady } from "./domain/monthly";

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
  const [theme, setTheme] = useState(() =>
    typeof document === "undefined"
      ? "light"
      : document.documentElement.dataset.theme || "light",
  );
  const [message, setMessage] = useState(""),
    [undo, setUndo] = useState<Portfolio | null>(null),
    [beforeDemo, setBeforeDemo] = useState<Portfolio | null>(null);
  const [editorSetup, setEditorSetup] = useState(false);
  const [executing, setExecuting] = useState(false),
    [riskAfter, setRiskAfter] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    file = useRef<HTMLInputElement>(null),
    executionLock = useRef(false);
  const signature = JSON.stringify(p),
    issues = validate(p),
    valid = issues.length === 0,
    total = totals(p);
  const planIssues = validate(p, { forPlan: true });
  const plan = useMemo(() => {
    if (!monthlyReady(p) || validate(p, { forPlan: true }).length) return null;
    return rebalance(p);
  }, [signature]);
  const age = snapshotAge(p.snapshot?.asOf),
    stale = total.invested > 0 && (age === null || age > 30);
  const risk = valid ? stress(p, riskAfter && plan ? plan : undefined) : null;
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
  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("portfolio-pilot:theme", next);
    } catch {}
  };
  const exportData = () => {
    if (!valid) {
      setMessage("请先修正输入，再导出备份。");
      return;
    }
    downloadText(
      JSON.stringify(envelope(p), null, 2),
      `portfolio-pilot-${new Date().toISOString().slice(0, 10)}.json`,
    );
    setMessage("备份已导出。");
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
  const importFile = async (f: File) => {
    try {
      if (f.size > MAX_BACKUP_BYTES)
        throw new Error("备份文件不能超过 1 MiB。");
      const e = parseBackup(await f.text());
      if (!window.confirm("导入会替换当前持仓、策略与执行记录，继续吗？"))
        return;
      replaceData(e.portfolio);
      setMessage("已恢复备份。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "导入失败。");
    } finally {
      if (file.current) file.current.value = "";
    }
  };
  const startDemo = () => {
    const demo = demoPortfolio(),
      profile: RiskProfile = {
        horizon: "3to7",
        reserve: "over6",
        loss: 35,
        reaction: "hold",
        region: "equal",
      };
    setBeforeDemo(p);
    setP({
      ...confirmStrategy(
        demo,
        [40, 35, 25, 0, 0],
        profile,
        "不含债券的示例",
        true,
      ),
      monthlyPlan: { budget: 4000, assetIds: ["us", "cn", "gold"] },
      snapshot: {
        asOf: new Date().toISOString().slice(0, 10),
        estimated: true,
      },
    });
    setUndo(null);
    go("monthly");
  };
  const finishExecution = () => {
    if (!plan || blocked || executionLock.current) return;
    executionLock.current = true;
    try {
      const next = executePlan(p, plan);
      setUndo(p);
      setP(next);
      setMessage("已按计划更新估算持仓；下次请核对实际市值。");
      setExecuting(false);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "记录失败。");
    } finally {
      setTimeout(() => {
        executionLock.current = false;
      }, 0);
    }
  };
  const pageTitles: Record<Page, [string, string]> = {
    monthly: [
      "每月定投，照着计划执行",
      "预算、类别和比例确认一次，清楚知道每个月各投多少。",
    ],
    plan: [
      "再平衡，知道该怎样调整",
      "对照目标找出超配与低配，选择用后续定投或买卖调回。",
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
                onClick={() => go(id)}
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
              className="icon-btn"
              aria-label={theme === "light" ? "切换深色主题" : "切换浅色主题"}
              onClick={toggleTheme}
            >
              <Icon name={theme === "light" ? "moon" : "sun"} />
            </button>
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
            <button className="text-button" onClick={startDemo}>
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
              setP(next);
              setUndo(null);
              go("monthly");
              setMessage("每月定投计划已确认；需要纠偏时查看再平衡指导。");
            }}
            onCancel={() => go("monthly")}
          />
        )}
        {page === "holdings" && (
          <HoldingsEditor
            p={p}
            onSave={(next) => {
              setP(next);
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
          <MonthlyDashboard
            p={p}
            onEdit={(setup) => {
              setEditorSetup(setup);
              go("strategy");
            }}
            onRebalance={() => {
              if (p.budget === 0 && p.monthlyPlan)
                apply({ budget: p.monthlyPlan.budget });
              go("plan");
            }}
            onHoldings={() => go("holdings")}
          />
        )}
        {page === "plan" && (
          <>
            {stale && (
              <div className="notice warning">
                <Icon name="info" />
                <span>
                  {age === null
                    ? "持仓日期尚未确认，请核对市值后参考再平衡金额。"
                    : `持仓已 ${age} 天未核对，计划可能与最新市值不同。`}
                </span>
                <button className="text-button" onClick={() => go("holdings")}>
                  核对持仓
                </button>
              </div>
            )}
            {p.snapshot?.estimated && (
              <p className="estimate-note">
                <Icon name="info" size={15} />
                当前为估算持仓，未包含最新净值、费用与实际成交差异。
              </p>
            )}
            <RebalanceDashboard
              p={p}
              plan={plan}
              issues={planIssues}
              blocked={blocked}
              onEdit={() => {
                setEditorSetup(true);
                go("strategy");
              }}
              onHoldings={() => go("holdings")}
              onBudget={(budget) => apply({ budget, source: "external" })}
              onExecute={() => {
                executionLock.current = false;
                setExecuting(true);
              }}
            />
            {!!p.history?.length && (
              <details className="panel execution-history">
                <summary>
                  <strong>最近再平衡执行记录</strong>
                  <span>{p.history.length} 笔</span>
                </summary>
                {p.history.map((r) => (
                  <div className="history-row" key={r.id}>
                    <div>
                      <strong>{r.executedAt.slice(0, 10)}</strong>
                      <p>
                        {r.buys
                          .map((a) => `${a.name} ${money(a.amount)}`)
                          .join(" · ") || "本次未安排买入"}
                      </p>
                    </div>
                    <span>{money(r.budget)}</span>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
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
          <>
            <Panel
              title="备份与恢复"
              description="持仓、目标比例、风险评估和最近执行记录一起保存。"
            >
              <div className="backup-grid">
                <div>
                  <Icon name="download" size={28} />
                  <h3>保存一份备份</h3>
                  <p>重要调整后导出，换设备时再导入。</p>
                  <button className="btn primary" onClick={exportData}>
                    导出 JSON 备份
                  </button>
                </div>
                <div>
                  <Icon name="upload" size={28} />
                  <h3>从备份恢复</h3>
                  <p>恢复当前版本导出的 JSON 备份。</p>
                  <button className="btn" onClick={() => file.current?.click()}>
                    选择备份文件
                  </button>
                  <input
                    ref={file}
                    className="visually-hidden"
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void importFile(f);
                    }}
                  />
                </div>
              </div>
            </Panel>
            {blocked && (
              <Panel title="原始数据仍保留">
                <p>当前保存已暂停，可先下载原始内容，再导入有效备份恢复。</p>
                <button
                  className="btn"
                  onClick={() =>
                    downloadText(
                      recovery,
                      "portfolio-pilot-recovery.txt",
                      "text/plain",
                    )
                  }
                >
                  下载原始内容
                </button>
              </Panel>
            )}
            <Panel title="本地存储说明">
              <p className="body-copy">
                所有数据只保存在当前浏览器，没有云同步。清理浏览器数据会丢失记录。建议在重要调整后导出一份备份。
              </p>
              {savedAt && (
                <p className="field-note">
                  最近自动保存：{new Date(savedAt).toLocaleString()}
                </p>
              )}
            </Panel>
            <Panel title="重新开始">
              <div className="maintenance-row">
                <p>清空本工具当前的持仓、策略与记录，建议先导出备份。</p>
                <button
                  className="btn danger"
                  onClick={() => {
                    if (window.confirm("清空当前持仓、策略和执行记录？")) {
                      replaceData(emptyPortfolio());
                      setMessage("已重新开始。");
                    }
                  }}
                >
                  清空当前配置
                </button>
              </div>
            </Panel>
          </>
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
      {executing && plan && (
        <Modal
          title="已经按这份计划完成操作？"
          onClose={() => setExecuting(false)}
        >
          <p className="body-copy">
            确认后更新估算持仓并扣除剩余可买额度。本次再平衡金额会清零，每月固定定投预算保持不变。
          </p>
          <div className="execution-confirm-list">
            {plan.rows
              .filter((r) => r.buy > 0 && r.id !== CASH_ID)
              .map((r) => (
                <div key={r.id}>
                  <span>{p.assets.find((a) => a.id === r.id)!.name}</span>
                  <strong>{money(r.buy)}</strong>
                </div>
              ))}
            {plan.keptCash > 0 && (
              <div>
                <span>
                  {p.source === "cash" ? "预算中未动用" : "预算中留作现金"}
                </span>
                <strong>{money(plan.keptCash)}</strong>
              </div>
            )}
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
                setMessage("已撤销，恢复执行前的持仓、预算和额度。");
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
