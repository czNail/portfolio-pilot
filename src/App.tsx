import { useEffect, useMemo, useRef, useState } from "react";
import {
  emptyPortfolio,
  demoPortfolio,
  totals,
  validate,
  CASH_ID,
  type Portfolio,
} from "./domain/model";
import { rebalance, stress, type Plan } from "./domain/rebalance";
import {
  strategyConfirmed,
  confirmStrategy,
  type RiskProfile,
} from "./domain/strategy";
import {
  describePlan,
  deviation,
  executePlan,
  fullRebalance,
  snapshotAge,
} from "./domain/planning";
import { loadPortfolio } from "./storage/session";
import {
  STORAGE_KEY,
  MAX_BACKUP_BYTES,
  envelope,
  parseBackup,
  downloadText,
} from "./storage/backup";
import {
  Icon,
  NumberField,
  Panel,
  Modal,
  colors,
  money,
  pct,
} from "./components";
import { ShareSlider, PlanTable } from "./AllocationControls";
import StrategyEditor, { AllocationMix } from "./StrategyEditor";
import HoldingsEditor from "./HoldingsEditor";

type Page = "plan" | "holdings" | "strategy" | "risk" | "backup";
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
const shortPct = (n: number) => `${Number(n.toFixed(2))}%`;
export default function App() {
  const [initial] = useState(boot),
    [p, setP] = useState(initial.p),
    [page, setPage] = useState<Page>("plan");
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
  const [executing, setExecuting] = useState(false),
    [riskAfter, setRiskAfter] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    file = useRef<HTMLInputElement>(null),
    executionLock = useRef(false);
  const signature = JSON.stringify(p),
    issues = validate(p),
    valid = issues.length === 0,
    confirmed = strategyConfirmed(p),
    total = totals(p);
  const planIssues = validate(p, { forPlan: true });
  const plan = useMemo(() => {
    if (!strategyConfirmed(p) || validate(p, { forPlan: true }).length)
      return null;
    return rebalance(p);
  }, [signature]);
  const analysis = plan ? describePlan(p, plan) : null,
    currentDeviation = deviation(p),
    age = snapshotAge(p.snapshot?.asOf),
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
    go("plan");
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
      ...confirmStrategy(demo, [35, 20, 10, 30, 5], profile, "示例策略", true),
      snapshot: {
        asOf: new Date().toISOString().slice(0, 10),
        estimated: true,
      },
    });
    setUndo(null);
    go("plan");
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
  const exportPlan = () => {
    if (!plan) return;
    const quote = (s: string) =>
      `"${(/^[\s]*[=+\-@]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`;
    const rows = [
      [
        "资产类别",
        "当前市值",
        "本次买入",
        "计划后市值",
        "计划后占比%",
        "目标占比%",
      ],
      ...plan.rows.map((r) => [
        p.assets.find((a) => a.id === r.id)!.name,
        r.current.toFixed(2),
        r.id === CASH_ID ? "现金余额见计划后市值" : r.buy.toFixed(2),
        r.after.toFixed(2),
        r.afterWeight.toFixed(2),
        r.target.toFixed(2),
      ]),
    ];
    downloadText(
      "\uFEFF" + rows.map((row) => row.map(quote).join(",")).join("\r\n"),
      "portfolio-plan.csv",
      "text/csv;charset=utf-8",
    );
  };
  const pageTitles: Record<Page, [string, string]> = {
    plan: ["下一笔钱，投得更有数", "确定长期目标，每次只处理眼前这笔投入。"],
    holdings: ["更新我的持仓", "按资产大类记下市值，计划会据此重新计算。"],
    strategy: [
      "找到适合自己的比例",
      "结合资金期限与风险承受能力，确定一份长期目标。",
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
              go("plan");
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
                ["plan", "投资计划"],
                ["holdings", "我的持仓"],
                ["strategy", "长期策略"],
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
          {page === "plan" && !p.demo && (
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
                go("plan");
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
            onSave={(next) => {
              setP(next);
              setUndo(null);
              go("plan");
              setMessage("长期目标已确认，之后可直接计算投入计划。");
            }}
            onCancel={() => go("plan")}
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
        {page === "plan" && (
          <>
            {!confirmed ? (
              <section className="welcome-card panel">
                <div className="welcome-copy">
                  <span className="pill">
                    {total.invested > 0
                      ? "持仓已录入"
                      : "第一次使用 · 约 1 分钟"}
                  </span>
                  <h2>
                    先定好比例，
                    <br />
                    以后每笔投入都更简单。
                  </h2>
                  <p>
                    回答 4 个问题，得到有依据的配置比例。
                    <br />
                    确认后，填入持仓和预算就能查看买入计划。
                  </p>
                  <button
                    className="btn primary"
                    onClick={() => go("strategy")}
                  >
                    确定我的长期策略
                    <Icon name="arrow" size={18} />
                  </button>
                  <button
                    className="text-button"
                    onClick={() => go("holdings")}
                  >
                    {total.invested > 0 ? "先核对已有持仓" : "也可以先录入持仓"}
                  </button>
                </div>
                <div className="welcome-steps">
                  <div>
                    <span>01</span>
                    <div>
                      <strong>了解自己的风险</strong>
                      <p>资金何时要用，能承受多少亏损</p>
                    </div>
                  </div>
                  <div>
                    <span>02</span>
                    <div>
                      <strong>确认一份目标比例</strong>
                      <p>有说明、能调整，长期沿用</p>
                    </div>
                  </div>
                  <div>
                    <span>03</span>
                    <div>
                      <strong>看清这次怎么买</strong>
                      <p>优先补低配，也告诉你还差多少</p>
                    </div>
                  </div>
                </div>
              </section>
            ) : (
              <>
                <div className="dashboard-summary">
                  <div className="portfolio-summary">
                    <span>参与配置的组合</span>
                    <strong>{money(total.invested)}</strong>
                    <button
                      className="text-button"
                      onClick={() => go("holdings")}
                    >
                      <Icon name="edit" size={14} />
                      更新持仓
                    </button>
                    <p>
                      {p.snapshot
                        ? `${p.snapshot.asOf} · ${p.snapshot.estimated ? "估算持仓" : "已核对市值"}`
                        : total.invested > 0
                          ? "尚未确认持仓日期"
                          : "尚未录入持仓，可从第一笔投入开始"}
                    </p>
                  </div>
                  <div className="deviation-summary">
                    <span>最大目标偏差</span>
                    <strong>
                      {total.invested > 0
                        ? `${currentDeviation.max.toFixed(1)}`
                        : "—"}
                      <small>{total.invested > 0 ? "个百分点" : ""}</small>
                    </strong>
                    <span
                      className={`pill ${!currentDeviation.breached ? "good" : ""}`}
                    >
                      {total.invested <= 0
                        ? "等待第一笔投入"
                        : currentDeviation.breached
                          ? "有资产超出容忍范围"
                          : "在容忍范围内"}
                    </span>
                  </div>
                  <div className="strategy-summary">
                    <span>已确认的长期策略</span>
                    <strong>{p.strategy!.label}</strong>
                    <p>
                      第 {p.strategy!.revision} 版 ·{" "}
                      {p.strategy!.confirmedAt.slice(0, 10)}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => go("strategy")}
                    >
                      查看或调整
                      <Icon name="arrow" size={14} />
                    </button>
                  </div>
                </div>
                {stale && (
                  <div className="notice warning">
                    <Icon name="info" />
                    <span>
                      {age === null
                        ? "持仓日期尚未确认，计划按已录入的金额计算。"
                        : `持仓已超过 ${age} 天未核对，最新市值可能改变买入金额。`}
                    </span>
                    <button
                      className="text-button"
                      onClick={() => go("holdings")}
                    >
                      核对市值
                    </button>
                  </div>
                )}
                {p.snapshot?.estimated && total.invested > 0 && !stale && (
                  <p className="estimate-note">
                    <Icon name="info" size={15} />
                    持仓为估算值，未包含净值变化、手续费或实际成交差异。
                    <button
                      className="text-button"
                      onClick={() => go("holdings")}
                    >
                      按实际市值更新
                    </button>
                  </p>
                )}
                <div className="plan-layout">
                  <Panel
                    className="investment-panel"
                    title="这次准备投入多少？"
                    description="默认使用新增资金，优先补足低配资产。"
                    action={<span className="pill">仅买入</span>}
                  >
                    <div className="budget-entry">
                      <NumberField
                        label="本次投入金额"
                        hideLabel
                        value={p.budget}
                        emptyZero
                        placeholder="输入本次预算"
                        onChange={(v) => apply({ budget: v ?? 0 })}
                      />
                    </div>
                    <div className="quick-budgets">
                      {[1000, 4000, 10000].map((v) => (
                        <button
                          key={v}
                          className={p.budget === v ? "selected" : ""}
                          onClick={() => apply({ budget: v })}
                        >
                          {money(v).replace(".00", "")}
                        </button>
                      ))}
                      <button onClick={() => apply({ budget: 0 })}>清零</button>
                    </div>
                    <details className="inline-details advanced-plan">
                      <summary>
                        资金来源与买入限制
                        <span>
                          {p.source === "external"
                            ? "新增资金"
                            : p.source === "cash"
                              ? "组合现金"
                              : "从备用金转入"}{" "}
                          · {p.rounding} 元取整
                        </span>
                      </summary>
                      <label className="field">
                        本次资金来源
                        <select
                          value={p.source}
                          onChange={(e) =>
                            apply({
                              source: e.target.value as Portfolio["source"],
                            })
                          }
                        >
                          <option value="external">外部新增资金</option>
                          <option value="cash">使用组合现金</option>
                          <option value="reserve">从备用金转入</option>
                        </select>
                      </label>
                      <p className="field-note">
                        {p.source === "external"
                          ? "新增预算会计入组合总额。"
                          : p.source === "cash"
                            ? `从组合现金 ${money(p.assets.find((a) => a.id === CASH_ID)!.value)} 内安排，不增加总资产。`
                            : `备用金尚有 ${money(p.reserve)}。转入后会减少生活安全垫，请确认仍足以应对开支。`}
                      </p>
                      <label className="field">
                        买入金额取整
                        <select
                          value={p.rounding}
                          onChange={(e) =>
                            apply({
                              rounding: Number(
                                e.target.value,
                              ) as Portfolio["rounding"],
                            })
                          }
                        >
                          {[1, 10, 100].map((v) => (
                            <option key={v} value={v}>
                              {v} 元一档
                            </option>
                          ))}
                        </select>
                      </label>
                      <details className="inline-details">
                        <summary>本月剩余可买额度</summary>
                        <p className="field-note">
                          留空即不限，0
                          表示暂停。记录执行后扣除额度；跨月需要手动更新。
                        </p>
                        <div className="limit-grid">
                          {p.assets
                            .filter((a) => a.id !== CASH_ID)
                            .map((a) => (
                              <NumberField
                                key={a.id}
                                label={a.name}
                                nullable
                                value={a.monthlyLimit}
                                onChange={(v) =>
                                  apply({
                                    assets: p.assets.map((x) =>
                                      x.id === a.id
                                        ? { ...x, monthlyLimit: v }
                                        : x,
                                    ),
                                  })
                                }
                              />
                            ))}
                        </div>
                      </details>
                    </details>
                    {planIssues.length > 0 && (
                      <div className="notice warning" role="alert">
                        {planIssues.join(" ")}
                      </div>
                    )}
                    {plan && analysis && (
                      <>
                        <div
                          className={`decision-note ${analysis.after.breached ? "attention" : ""}`}
                        >
                          <Icon
                            name={analysis.after.breached ? "info" : "check"}
                            size={20}
                          />
                          <div>
                            <strong>{analysis.title}</strong>
                            <p>{analysis.detail}</p>
                          </div>
                        </div>
                        {p.budget > 0 ? (
                          <>
                            <div className="buy-list">
                              <p className="list-caption">本次安排</p>
                              {plan.rows
                                .filter((r) => r.id !== CASH_ID && r.buy > 0)
                                .map((r) => {
                                  const i = p.assets.findIndex(
                                      (a) => a.id === r.id,
                                    ),
                                    a = p.assets[i];
                                  return (
                                    <div className="buy-row" key={r.id}>
                                      <div>
                                        <span className="asset-name">
                                          <i
                                            style={{
                                              background:
                                                colors[i % colors.length],
                                            }}
                                          />
                                          {a.name}
                                        </span>
                                        <small>
                                          {r.beforeWeight < r.target
                                            ? "补足低配"
                                            : "按目标分配"}{" "}
                                          · 计划后 {shortPct(r.afterWeight)}
                                        </small>
                                      </div>
                                      <strong>+ {money(r.buy)}</strong>
                                    </div>
                                  );
                                })}
                              {plan.keptCash > 0 && (
                                <div className="buy-row cash-row">
                                  <div>
                                    <span className="asset-name">
                                      <i
                                        style={{
                                          background:
                                            colors[
                                              p.assets.findIndex(
                                                (a) => a.id === CASH_ID,
                                              ) % colors.length
                                            ],
                                        }}
                                      />
                                      {p.source === "cash"
                                        ? "暂不动用的预算"
                                        : "留在组合现金"}
                                    </span>
                                    <small>目标现金、限额或取整后的余额</small>
                                  </div>
                                  <strong>{money(plan.keptCash)}</strong>
                                </div>
                              )}
                            </div>
                            <div className="plan-outcome">
                              <div>
                                <span>最大偏差</span>
                                <strong>
                                  {total.invested > 0
                                    ? `${plan.maxBefore.toFixed(1)} → `
                                    : ""}
                                  {plan.maxAfter.toFixed(1)}{" "}
                                  <small>个百分点</small>
                                </strong>
                              </div>
                              <div>
                                <span>计划后组合</span>
                                <strong>{money(plan.portfolioAfter)}</strong>
                              </div>
                            </div>
                            <div className="plan-buttons">
                              <button
                                className="btn primary"
                                disabled={blocked}
                                onClick={() => {
                                  executionLock.current = false;
                                  setExecuting(true);
                                }}
                              >
                                <Icon name="check" size={18} />
                                记录已按计划执行
                              </button>
                              <button
                                className="text-button"
                                onClick={exportPlan}
                              >
                                <Icon name="download" size={16} />
                                导出
                              </button>
                            </div>
                            <p className="field-note">
                              实际完成操作后再记录。工具提供计算，不会自动交易。
                            </p>
                          </>
                        ) : (
                          <div className="zero-budget">
                            <Icon name="plan" size={29} />
                            <strong>
                              {p.history?.length
                                ? "本次执行已记录，可以准备下一笔投入"
                                : "输入预算，查看这次买什么"}
                            </strong>
                            <p>
                              无需改动长期比例；仅想查看偏差时，可保持预算为 0。
                            </p>
                          </div>
                        )}
                        <details className="inline-details plan-detail">
                          <summary>查看各类占比与计算细节</summary>
                          <PlanTable p={p} plan={plan} />
                          <p className="field-note">
                            目标为零或已超配的类别不再买入。限额不足、现金目标和金额取整可能留下现金余额。
                          </p>
                        </details>
                      </>
                    )}
                  </Panel>
                  <aside className="plan-sidebar">
                    <Panel
                      title="我的目标比例"
                      action={
                        <button
                          className="text-button"
                          onClick={() => go("strategy")}
                        >
                          调整
                        </button>
                      }
                    >
                      <AllocationMix
                        p={p}
                        weights={p.assets.map((a) => a.target)}
                      />
                      <button
                        className="sidebar-link"
                        onClick={() => go("risk")}
                      >
                        <Icon name="risk" size={18} />
                        <span>查看组合压力情景</span>
                        <Icon name="arrow" size={15} />
                      </button>
                    </Panel>
                    {analysis?.after.breached && (
                      <Panel
                        title="还需要再平衡吗？"
                        className="rebalance-explanation"
                      >
                        <p>
                          投入后仍有资产超过提醒阈值。可以继续用后续资金补低配。
                        </p>
                        {p.source === "external" && (
                          <p className="field-note">
                            {analysis.needed === null
                              ? "持有目标为 0% 的类别，仅追加资金无法完全恢复目标比例。"
                              : `若价格不变、不受限额及取整影响，从当前持仓出发至少需累计追加 ${money(analysis.needed)}，才可能精确达到目标。`}
                          </p>
                        )}
                        <details className="inline-details sell-reference">
                          <summary>查看含卖出的参考方案</summary>
                          <p className="field-note">
                            按本次预算后的总额换算至目标比例。未计交易费、税费、赎回限制和买入取整；仅供比较，不能直接记录为已执行。
                          </p>
                          <div className="reference-list">
                            {plan &&
                              fullRebalance(p, plan).map((r) => (
                                <div key={r.id}>
                                  <span>
                                    {r.name}
                                    <small>
                                      {r.limited ? "超过本月剩余额度" : ""}
                                    </small>
                                  </span>
                                  <strong
                                    className={
                                      r.id !== CASH_ID && r.change < 0
                                        ? "danger"
                                        : ""
                                    }
                                  >
                                    {r.id === CASH_ID
                                      ? `保留 ${money(r.after)}`
                                      : r.change < 0
                                        ? `卖出 ${money(-r.change)}`
                                        : r.change > 0
                                          ? `买入 ${money(r.change)}`
                                          : "不调整"}
                                  </strong>
                                </div>
                              ))}
                          </div>
                          <button
                            className="text-button"
                            onClick={() => go("holdings")}
                          >
                            实际买卖后，按市值更新持仓
                          </button>
                        </details>
                      </Panel>
                    )}
                  </aside>
                </div>
                {!!p.history?.length && (
                  <details className="panel execution-history">
                    <summary>
                      <strong>最近执行记录</strong>
                      <span>{p.history.length} 笔 · 保留最近 20 笔</span>
                    </summary>
                    {p.history.map((r) => (
                      <div className="history-row" key={r.id}>
                        <div>
                          <strong>{r.executedAt.slice(0, 10)}</strong>
                          <p>
                            {r.buys
                              .map((a) => `${a.name} ${money(a.amount)}`)
                              .join(" · ") || "本次全部保留现金"}
                            {r.keptCash > 0
                              ? ` · 预算余额 ${money(r.keptCash)}`
                              : ""}
                          </p>
                        </div>
                        <span>
                          {money(r.budget)}
                          <small>
                            {r.source === "external"
                              ? "新增资金"
                              : r.source === "cash"
                                ? "组合现金"
                                : "备用金转入"}
                          </small>
                        </span>
                      </div>
                    ))}
                  </details>
                )}
              </>
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
                返回投资计划
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
            确认后，按计划金额更新持仓并标记为估算值。本次预算会清零，剩余可买额度会扣除已买入金额。
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
