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
export default function RebalanceDashboard({
  p,
  plan,
  issues,
  onEdit,
  onHoldings,
  onBudget,
  onExecute,
  blocked,
}: {
  p: Portfolio;
  plan: Plan | null;
  issues: string[];
  onEdit: () => void;
  onHoldings: () => void;
  onBudget: (n: number) => void;
  onExecute: () => void;
  blocked: boolean;
}) {
  const [mode, setMode] = useState<"cashflow" | "trade">("cashflow");
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
                ? "需要把配置拉回目标范围"
                : "目前无需专门再平衡"}
          </h2>
          <p>
            {!total.invested
              ? "还没有持仓时，直接按每月固定计划开始投入。"
              : current.breached
                ? `${over.length ? names(over) + "超配，暂缓追加。" : ""}${under.length ? "优先补足" + names(under) + "。" : ""}`
                : "继续按固定定投清单执行，定期核对市值；不必为小偏差频繁交易。"}
          </p>
        </div>
        <button className="btn" onClick={onHoldings}>
          更新持仓
        </button>
      </div>
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
            ? "本月定投怎样调整？"
            : "这次需要卖出和买入多少？"
        }
        description={
          mode === "cashflow"
            ? "纠偏金额替代本月固定分配，不是在固定定投之外额外投入。"
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
          这里只调整本次金额；每月固定定投预算仍为 {money(monthly.budget)}。
        </p>
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
                      disabled={blocked}
                      onClick={onExecute}
                    >
                      <Icon name="check" size={18} />
                      记录已按本次纠偏计划执行
                    </button>
                    <button className="text-button" onClick={onHoldings}>
                      成交不同？更新实际持仓
                    </button>
                  </div>
                )}
                {current.breached && (
                  <div className="recovery-outlook">
                    <h3>后续定投还要怎么做？</h3>
                    <p>
                      每月把 {money(monthly.budget)}{" "}
                      优先分配给低配类别，超配类别暂缓追加；每次用最新持仓重新计算，回到范围后再按固定比例执行。
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
                  </div>
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
                <button className="btn primary" onClick={onHoldings}>
                  完成实际买卖后，更新持仓
                </button>
              </>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
