import { useState } from "react";
import { CASH_ID, totals, type Portfolio } from "./domain/model";
import type { Plan } from "./domain/rebalance";
import {
  deviation,
  fullRebalance,
  additionalToBand,
  contributionToTarget,
} from "./domain/planning";
import { monthlyReady, monthlyAllocation } from "./domain/monthly";
import { Panel, Icon, NumberField, money } from "./components";
import { PlanTable } from "./AllocationControls";
import { reportText } from "./domain/report";
import { Modal } from "./components";
import type { ReviewMethod } from "./domain/review";
export default function RebalanceDashboard({
  p,
  plan,
  issues,
  onEdit,
  onHoldings,
  onBudget,
  onExecute,
  blocked,
  onRounding,
  onActual,
  reviewMode = false,
  mode: selectedMode,
  onMode,
  onNoChange,
}: {
  p: Portfolio;
  plan: Plan | null;
  issues: string[];
  onEdit: () => void;
  onHoldings: () => void;
  onBudget: (n: number) => void;
  onExecute: () => void;
  blocked: boolean;
  onRounding?: (n: Portfolio["rounding"]) => void;
  onActual?: () => void;
  reviewMode?: boolean;
  mode?: ReviewMethod;
  onMode?: (mode: ReviewMethod) => void;
  onNoChange?: () => void;
}) {
  const [localMode, setLocalMode] = useState<ReviewMethod>("cashflow");
  const mode = selectedMode ?? localMode;
  const setMode = (next: ReviewMethod) => {
    setLocalMode(next);
    onMode?.(next);
  };
  const [copyFallback, setCopyFallback] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!monthlyReady(p))
    return (
      <Panel title="先确认定投目标比例">
        <p className="body-copy">
          再平衡需要一份已确认的目标，再将它与实际持仓比较。
        </p>
        <button className="btn primary" onClick={onEdit}>
          制定每月定投计划
        </button>
      </Panel>
    );
  const current = deviation(p),
    total = totals(p),
    monthly = monthlyAllocation(p),
    needed = additionalToBand(p),
    exact = contributionToTarget(p),
    full = plan ? fullRebalance(p, plan) : [];
  const over = current.rows.filter((r) => r.delta > r.limit + 1e-7),
    under = current.rows.filter((r) => r.delta < -r.limit - 1e-7),
    forecast = needed === null ? null : Math.ceil(needed / monthly.budget);
  const names = (rows: typeof over) =>
    rows.map((r) => p.assets.find((a) => a.id === r.id)!.name).join("、");
  const report = plan ? reportText(p, plan, mode) : "";
  const cashflowEnough = plan && !deviation(p, plan).breached;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setCopyFallback(true);
    }
  };
  return (
    <>
      <div
        className={`rebalance-status panel ${current.breached ? "attention" : ""}`}
      >
        <Icon name={current.breached ? "info" : "check"} size={28} />
        <div>
          <p>
            当前组合 {money(total.invested)} · 最大偏差 {current.max.toFixed(1)}{" "}
            个百分点
          </p>
          <h2>
            {!total.invested
              ? "先录入持仓，才能判断怎样再平衡"
              : current.breached
                ? cashflowEnough
                  ? "本次新增资金可以把偏差调回范围"
                  : "本次偏差较大，比较两种调整方案"
                : "目前无需专门再平衡"}
          </h2>
          <p>
            {!total.invested
              ? "还没有持仓时，直接按每月固定计划开始投入。"
              : current.breached
                ? `${over.length ? names(over) + "超配，暂缓追加。" : ""}${under.length ? "优先补足" + names(under) + "。" : ""}`
                : "继续按原计划定投，结束本次复查后按安排再来检查。"}
          </p>
        </div>
        <div className="button-row">
          {onNoChange && !current.breached && (
            <button
              className="btn primary"
              disabled={blocked || !plan}
              onClick={onNoChange}
            >
              本次无需调整，结束复查
            </button>
          )}
          <button className="btn" onClick={onHoldings}>
            更新持仓
          </button>
        </div>
      </div>
      {current.breached && plan && (
        <div className="review-comparison">
          <div className="panel">
            <strong>新增资金纠偏</strong>
            <p>本次买入 {money(plan.bought)} · 卖出 ¥0.00</p>
            <span>
              {cashflowEnough
                ? "本次可回到容忍范围"
                : "本次后仍有偏差，可与买卖方案比较"}
            </span>
          </div>
          <div className="panel">
            <strong>买卖调整</strong>
            <p>
              买入{" "}
              {money(
                full
                  .filter((r) => r.id !== CASH_ID && r.change > 0)
                  .reduce((s, r) => s + r.change, 0),
              )}{" "}
              · 卖出{" "}
              {money(
                full
                  .filter((r) => r.id !== CASH_ID && r.change < 0)
                  .reduce((s, r) => s - r.change, 0),
              )}
            </p>
            <span>接近目标比例；先考虑费用、限额和到账时间</span>
          </div>
        </div>
      )}
      {total.invested > 0 && (
        <Panel
          title="持仓与目标差在哪里？"
          description="偏差用百分点表示。目标为 0% 的类别不再追加，已有持仓不会自动消失。"
        >
          <div className="rebalance-position-list">
            {p.assets
              .filter((a) => a.value > 0 || a.target > 0)
              .map((a) => {
                const row = current.rows.find((r) => r.id === a.id)!,
                  gap = (total.invested * a.target) / 100 - a.value;
                return (
                  <div key={a.id}>
                    <div>
                      <strong>{a.name}</strong>
                      <span>
                        当前 {row.weight.toFixed(1)}% → 目标 {a.target}%
                      </span>
                    </div>
                    <div>
                      <strong className={row.breached ? "accent" : ""}>
                        {row.delta > 0 ? "+" : ""}
                        {row.delta.toFixed(1)} 个百分点
                      </strong>
                      <span>
                        {gap > 0
                          ? "低配 " + money(gap)
                          : gap < 0
                            ? "超配 " + money(-gap)
                            : "正好达到目标"}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
          <p className="field-note">
            提醒偏差取绝对阈值 {p.strategy!.band} 个百分点与目标的{" "}
            {p.strategy!.relativeBand}%
            中较小者；上方金额差按当前组合总额计算，加入新资金后会重新计算。
          </p>
        </Panel>
      )}
      <div className="rebalance-mode">
        <button
          className={mode === "cashflow" ? "selected" : ""}
          onClick={() => setMode("cashflow")}
        >
          <Icon name="plan" size={20} />
          <span>
            <strong>用后续定投逐步调回</strong>
            <small>优先用新资金，不主动卖出</small>
          </span>
        </button>
        <button
          className={mode === "trade" ? "selected" : ""}
          onClick={() => setMode("trade")}
        >
          <Icon name="reset" size={20} />
          <span>
            <strong>通过买卖一次调回</strong>
            <small>列出卖出与买入金额</small>
          </span>
        </button>
      </div>
      <Panel
        title={
          mode === "cashflow"
            ? "这次新增资金怎样分配？"
            : "这次需要卖出和买入多少？"
        }
        description={
          mode === "cashflow"
            ? "只安排本次填写的资金；过去几个月的投入已包含在持仓市值中。"
            : "按当前持仓、目标比例和本次新增资金计算到目标的参考交易。"
        }
      >
        <div className="rebalance-budget">
          <NumberField
            label="本次用于再平衡的新增资金"
            value={p.budget}
            onChange={(v) => onBudget(v ?? 0)}
          />
          <button className="btn" onClick={() => onBudget(monthly.budget)}>
            使用月预算 {money(monthly.budget)}
          </button>
          <button className="text-button" onClick={() => onBudget(0)}>
            不追加资金
          </button>
        </div>
        <p className="field-note">
          这里只调整本次金额；每月固定定投预算仍为 {money(monthly.budget)}
          。过去的定投不要重复计入。
        </p>
        {onRounding && (
          <label className="field rounding-field">
            交易金额取整
            <select
              value={p.rounding}
              onChange={(e) =>
                onRounding(Number(e.target.value) as Portfolio["rounding"])
              }
            >
              <option value={1}>按 1 元</option>
              <option value={10}>按 10 元</option>
              <option value={100}>按 100 元</option>
            </select>
            <small>买入、卖出金额按步长取整，尾差保留在待投资余额。</small>
          </label>
        )}
        {issues.length > 0 && (
          <div className="notice warning" role="alert">
            {issues.join(" ")}
          </div>
        )}
        {plan && (
          <>
            {mode === "cashflow" ? (
              <>
                <div className="rebalance-action-list">
                  {p.assets
                    .filter(
                      (a) => a.id !== CASH_ID && (a.value > 0 || a.target > 0),
                    )
                    .map((a) => {
                      const r = plan.rows.find((r) => r.id === a.id)!,
                        fixed =
                          monthly.rows.find((r) => r.id === a.id)?.amount ?? 0;
                      return (
                        <div key={a.id}>
                          <div>
                            <strong>{a.name}</strong>
                            <span>
                              平常每月 {money(fixed)}
                              {a.monthlyLimit !== null
                                ? ` · 本月剩余额度 ${money(a.monthlyLimit)}`
                                : ""}
                            </span>
                          </div>
                          <div>
                            <strong className={r.buy > 0 ? "accent" : ""}>
                              {r.buy > 0
                                ? "本次投入 " + money(r.buy)
                                : p.budget === 0
                                  ? "本次不投入"
                                  : "本次暂停追加"}
                            </strong>
                            <span>
                              计划后 {r.afterWeight.toFixed(1)}% · 目标{" "}
                              {r.target}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  {plan.keptCash > 0 && (
                    <div>
                      <div>
                        <strong>{money(plan.keptCash)} 暂未安排</strong>
                        <span>
                          受目标缺口、取整或剩余额度约束。核对后再安排，不是重新预留生活现金。
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="recovery-result">
                  <strong>
                    最大偏差 {plan.maxBefore.toFixed(1)} →{" "}
                    {plan.maxAfter.toFixed(1)} 个百分点
                  </strong>
                  <p>
                    {deviation(p, plan).breached
                      ? "本次之后仍未全部回到容忍范围，可以继续定投纠偏，或切换买卖方案。"
                      : "本次计划后已回到容忍范围。后续按实际市值复核，再决定是否恢复固定比例。"}
                  </p>
                </div>
                {p.budget > 0 && (
                  <div className="plan-buttons">
                    <button
                      className="btn primary"
                      disabled={blocked || plan.bought <= 0}
                      onClick={onExecute}
                    >
                      <Icon name="check" size={18} />
                      记录已按本次纠偏计划执行
                    </button>
                    <button
                      className="text-button"
                      onClick={onActual ?? onHoldings}
                    >
                      成交不同？更新实际持仓
                    </button>
                  </div>
                )}
                {current.breached && (
                  <details className="recovery-outlook">
                    <summary>查看只用新增资金纠偏的理论资金需求</summary>
                    <p>
                      本次按上方清单安排。长期定投计划继续保留，下次复查时用最新市值判断；这里的预算倍数不决定复查日期。
                    </p>
                    <p>
                      {forecast === null
                        ? "当前条件下无法估算恢复时间。"
                        : `价格不变、忽略限额和取整，理想情况下至少需新增 ${money(needed!)}，约 ${Math.max(1, forecast)} 个月的月预算，才有可能回到容忍范围。`}
                    </p>
                    {forecast !== null && forecast > 12 && (
                      <div className="notice warning">
                        <span>
                          理论资金需求已超过 12
                          个月的预算，单靠新资金纠偏较慢。可以比较买卖方案，再结合交易成本决定。
                        </span>
                        <button
                          className="text-button"
                          onClick={() => setMode("trade")}
                        >
                          比较买卖方案
                        </button>
                      </div>
                    )}
                    <p className="field-note">
                      这是可达到容忍范围的资金量下界，不是收益或实际完成时间预测。
                      {exact === null
                        ? "持有目标为零的类别时，仅追加资金只能稀释其占比，无法将其金额精确降为零。"
                        : `若要求精确达到全部目标比例，理论上至少需累计新增 ${money(exact)}。`}
                    </p>
                  </details>
                )}
                <details className="inline-details">
                  <summary>查看计划前后完整比例</summary>
                  <PlanTable p={p} plan={plan} />
                </details>
              </>
            ) : (
              <>
                <div className="trade-reference-list">
                  {full
                    .filter(
                      (r) =>
                        r.id !== CASH_ID && (r.change !== 0 || r.after > 0),
                    )
                    .map((r) => (
                      <div key={r.id}>
                        <div>
                          <strong>{r.name}</strong>
                          <span>调整后市值 {money(r.after)}</span>
                          {r.limited && (
                            <small className="danger">
                              买入超过本月剩余额度，当前无法直接执行
                            </small>
                          )}
                        </div>
                        <strong className={r.change < 0 ? "danger" : "accent"}>
                          {r.change < 0
                            ? "卖出 " + money(-r.change)
                            : r.change > 0
                              ? "买入 " + money(r.change)
                              : "无需交易"}
                        </strong>
                      </div>
                    ))}
                </div>
                {(p.assets.find((a) => a.id === CASH_ID)?.value ?? 0) > 0 && (
                  <p className="field-note">
                    本方案也使用组合内的待投资余额{" "}
                    {money(p.assets.find((a) => a.id === CASH_ID)!.value)}
                    ，不包含预留的生活现金。
                  </p>
                )}
                <div className="trade-totals">
                  <span>
                    卖出合计{" "}
                    <strong>
                      {money(
                        full
                          .filter((r) => r.id !== CASH_ID && r.change < 0)
                          .reduce((s, r) => s - r.change, 0),
                      )}
                    </strong>
                  </span>
                  <span>
                    买入合计{" "}
                    <strong>
                      {money(
                        full
                          .filter((r) => r.id !== CASH_ID && r.change > 0)
                          .reduce((s, r) => s + r.change, 0),
                      )}
                    </strong>
                  </span>
                </div>
                <p className="field-note">
                  这是调回目标比例的金额参考，未计费用、税费、赎回限制、限购和实际成交差异。先核对卖出成本与到账时间，再安排买入；存在额度提示时，分批进行或先用定投纠偏。
                </p>
                <p className="field-note">
                  调整后待投资余额{" "}
                  {money(full.find((r) => r.id === CASH_ID)?.after ?? 0)}
                  ，用于保留交易取整尾差。
                </p>
                <div className="button-row">
                  {reviewMode && (
                    <button
                      className="btn primary"
                      disabled={
                        blocked ||
                        full.some((r) => r.limited) ||
                        !full.some((r) => r.change !== 0)
                      }
                      onClick={onExecute}
                    >
                      记录已按买卖方案执行
                    </button>
                  )}
                  <button className="btn" onClick={onActual ?? onHoldings}>
                    完成实际买卖后，更新持仓
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {plan && (
          <div className="report-actions">
            <button className="btn" onClick={copy}>
              复制本次方案
            </button>
            <button className="btn" onClick={() => window.print()}>
              打印本次方案
            </button>
            <span role="status">
              {copied ? "已复制；修改方案后请重新复制。" : ""}
            </span>
          </div>
        )}
      </Panel>
      {plan && (
        <section className="print-report">
          <h1>本次复查方案</h1>
          <pre>{report}</pre>
        </section>
      )}
      {copyFallback && (
        <Modal title="复制本次方案" onClose={() => setCopyFallback(false)}>
          <p>浏览器暂不能直接复制，请选中下面的内容复制。</p>
          <textarea
            className="report-copy"
            aria-label="本次方案文本"
            readOnly
            value={report}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button className="btn" onClick={() => setCopyFallback(false)}>
            完成
          </button>
        </Modal>
      )}
    </>
  );
}
