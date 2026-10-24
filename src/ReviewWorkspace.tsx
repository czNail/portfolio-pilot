import { useEffect, useRef } from "react";
import type { Portfolio } from "./domain/model";
import { capture, reviewState, type ReviewRecord } from "./domain/review";
import { deviation, snapshotAge } from "./domain/planning";
import { rebalance } from "./domain/rebalance";
import { validate } from "./domain/model";
import AdjustmentWorkspace from "./AdjustmentWorkspace";
import HoldingsEditor from "./HoldingsEditor";
import RebalanceDashboard from "./RebalanceDashboard";
import { Panel, NumberField, money } from "./components";

export default function ReviewWorkspace({
  p,
  onChange,
  onPause,
  onSaveAdjustment,
  onComplete,
  onEstimate,
  onEdit,
  blocked,
}: {
  p: Portfolio;
  onChange: (p: Portfolio) => void;
  onPause: () => void;
  onSaveAdjustment: (p: Portfolio) => void;
  onComplete: (outcome: ReviewRecord["outcome"], next?: Portfolio) => void;
  onEstimate: () => void;
  onEdit: () => void;
  blocked: boolean;
}) {
  const progress = useRef<HTMLElement>(null);
  const state = reviewState(p),
    session = state.active!;
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    progress.current?.focus({ preventScroll: true });
  }, [session.phase]);
  const setSession = (patch: Partial<typeof session>) =>
    onChange({ ...p, review: { ...state, active: { ...session, ...patch } } });
  const issues = validate(p, { forPlan: true }),
    plan = issues.length ? null : rebalance(p);
  const age = snapshotAge(p.snapshot?.asOf),
    stale = age === null || age > 30 || age < 0;
  return (
    <>
      <nav
        ref={progress}
        tabIndex={-1}
        className="review-progress"
        aria-label="本次复查进度"
      >
        {["核对持仓", "本次资金", "调整建议"].map((label, i) => (
          <span
            key={label}
            aria-current={
              i === ["holdings", "funding", "result"].indexOf(session.phase)
                ? "step"
                : undefined
            }
          >
            {i + 1}
            <strong>{label}</strong>
          </span>
        ))}
      </nav>
      {session.phase === "holdings" && (
        <>
          <div className="notice">
            <span>
              {session.finishing
                ? "填写实际成交后的市值，保存后结束本次复查。"
                : "沿用原来的类别与目标，只需要核对最新市值。过去几个月的投入已经包含在市值里。"}
            </span>
          </div>
          <HoldingsEditor
            key={session.finishing ? "actual" : "before"}
            p={p}
            onCancel={onPause}
            onSave={(next) => {
              if (session.finishing)
                onComplete("actual", {
                  ...next,
                  review: { ...state, active: { ...session, phase: "result" } },
                });
              else
                onChange({
                  ...next,
                  budget: 0,
                  source: "external",
                  review: {
                    ...state,
                    active: {
                      ...session,
                      phase: "funding",
                      before: capture(next),
                    },
                  },
                });
            }}
          />
        </>
      )}
      {session.phase === "funding" && (
        <Panel
          title="这次准备追加多少资金？"
          description="过去几个月的定投已计入刚核对的持仓，不要再次加进来。"
        >
          <NumberField
            label="本次用于再平衡的新增资金"
            value={p.budget}
            onChange={(v) =>
              onChange({ ...p, budget: v ?? 0, source: "external" })
            }
          />
          <div className="button-row">
            <button
              className="btn"
              onClick={() =>
                onChange({
                  ...p,
                  budget: p.monthlyPlan?.budget ?? 0,
                  source: "external",
                })
              }
            >
              使用一次月预算 {money(p.monthlyPlan?.budget ?? 0)}
            </button>
            <button
              className="text-button"
              onClick={() => onChange({ ...p, budget: 0, source: "external" })}
            >
              这次不追加
            </button>
          </div>
          <p className="field-note">
            没有新增资金也能检查偏差，或查看需要买卖多少。长期月预算不会改变。
          </p>
          {issues.length > 0 && (
            <p role="alert" className="danger">
              {issues.join(" ")}
            </p>
          )}
          <div className="editor-actions">
            <button
              className="btn"
              onClick={() => setSession({ phase: "holdings" })}
            >
              返回核对持仓
            </button>
            <button
              className="btn primary"
              disabled={blocked || issues.length > 0}
              onClick={() => setSession({ phase: "result" })}
            >
              查看本次建议
            </button>
          </div>
        </Panel>
      )}
      {session.phase === "result" && (
        <>
          {stale && (
            <div className="notice warning">
              <span>
                这份方案的持仓日期已经过期或尚未确认，请重新核对后执行。
              </span>
              <button
                className="btn"
                onClick={() =>
                  setSession({ phase: "holdings", finishing: false })
                }
              >
                重新核对持仓
              </button>
            </div>
          )}
          {plan && !issues.length && !stale && !deviation(p).breached && (
            <Panel title="目前无需专门再平衡">
              <p>持仓在目标容忍范围内，可以继续原定投。</p>
              <button
                className="btn primary"
                disabled={blocked}
                onClick={() => onComplete("unchanged")}
              >
                本次无需调整，结束复查
              </button>
            </Panel>
          )}
          <AdjustmentWorkspace
            p={p}
            onSave={onSaveAdjustment}
            blocked={blocked || stale}
          />
          <details className="panel advanced-transactions">
            <summary>单次测算与成交记录</summary>
            <RebalanceDashboard
              p={p}
              plan={plan}
              issues={issues}
              blocked={blocked || stale}
              onEdit={onEdit}
              onHoldings={() =>
                setSession({ phase: "holdings", finishing: false })
              }
              onActual={() =>
                setSession({ phase: "holdings", finishing: true })
              }
              onBudget={(budget) =>
                onChange({ ...p, budget, source: "external" })
              }
              onRounding={(rounding) => onChange({ ...p, rounding })}
              onExecute={onEstimate}
              onNoChange={() => onComplete("unchanged")}
              reviewMode
              mode={session.method}
              onMode={(method) => setSession({ method })}
            />
          </details>
          <Panel
            title="结束本次复查"
            description="保存本次结论和持仓快照，安排几个月后的下一次检查。"
          >
            <div className="button-row">
              <button
                className="btn"
                disabled={blocked}
                onClick={() =>
                  setSession({ phase: "holdings", finishing: true })
                }
              >
                已完成调整，填写实际结果
              </button>
              <button className="text-button" onClick={onPause}>
                尚未操作，保存方案下次继续
              </button>
            </div>
            <p className="field-note">
              还没操作时暂存即可；保持原目标和方案，不会把计划金额记成实际成交。
            </p>
          </Panel>
        </>
      )}
    </>
  );
}
