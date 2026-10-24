import { useState } from "react";
import { Panel, NumberField, money } from "./components";
import { cents, yuan, type Portfolio } from "./domain/model";
import {
  dailySettings,
  dailyIssues,
  buildAdjustment,
  type AdjustmentKind,
} from "./domain/daily";
import { deviation } from "./domain/planning";
import { localDate, reviewState, validDate } from "./domain/review";
import {
  kindNames,
  AdjustmentTable,
  InvestmentRules,
  CopyText,
  adjustmentText,
} from "./DailyWorkspace";

export default function AdjustmentWorkspace({
  p,
  onSave,
  blocked,
}: {
  p: Portfolio;
  onSave: (p: Portfolio) => void;
  blocked: boolean;
}) {
  const [kind, setKind] = useState<AdjustmentKind>("recurring");
  const [settings, setSettings] = useState(() => dailySettings(p));
  const [extra, setExtra] = useState(p.budget),
    [days, setDays] = useState(20);
  const [dailyBudget, setDailyBudget] = useState(settings.budget),
    [startDate, setStartDate] = useState(localDate());
  const [reviewOverride, setReviewOverride] = useState("");
  const [replace, setReplace] = useState(false);
  const recurring = kind === "recurring" || kind === "mixed";
  const trading = kind === "trade" || kind === "mixed";
  let plan: ReturnType<typeof buildAdjustment> | null = null,
    error = "";
  try {
    plan = buildAdjustment(
      { ...p, dailySettings: settings },
      settings,
      kind,
      kind === "recurring" ? 0 : extra,
      days,
      recurring ? dailyBudget : 0,
      startDate,
    );
    if (startDate < localDate())
      throw new Error("开始日期不能早于今天，请重新安排。");
    if (reviewOverride) {
      if (!validDate(reviewOverride) || reviewOverride < startDate)
        throw new Error("复查日期不能早于开始日期。");
      plan = { ...plan, reviewDate: reviewOverride };
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "请检查输入。";
    plan = null;
  }
  const current = deviation(p);
  const save = () => {
    if (!plan || blocked || dailyIssues(settings).length) return;
    onSave({
      ...p,
      dailySettings: settings,
      budget: 0,
      adjustment: plan,
      review: {
        ...reviewState(p),
        active: undefined,
        nextDate: plan.reviewDate,
      },
    });
  };
  const extraDaily = yuan(
    Math.max(0, cents(dailyBudget) - cents(settings.budget)),
  );
  return (
    <Panel
      title="选择这次怎样调整"
      description={`当前最大偏差 ${current.max.toFixed(1)} 个百分点。先选你愿意采用的方式，再看具体清单。`}
      className="adjustment-workspace"
    >
      {!current.breached && (
        <p className="notice">
          当前已在容忍范围内，可以继续原定投，无需为了精确比例而调整。
        </p>
      )}
      <div className="adjustment-choices" role="group" aria-label="调整方式">
        {(["recurring", "append", "trade", "mixed"] as const).map((k) => (
          <button
            type="button"
            key={k}
            aria-pressed={kind === k}
            className={kind === k ? "selected" : ""}
            onClick={() => {
              setKind(k);
              setReviewOverride("");
            }}
          >
            <strong>{kindNames[k]}</strong>
            <small>
              {
                {
                  recurring: "重新分配后续每日投入",
                  append: "只用一笔新增资金，不卖出",
                  trade: "明确允许卖出超配资产",
                  mixed: "一次性操作 + 临时定投",
                }[k]
              }
            </small>
          </button>
        ))}
      </div>
      <div className="daily-settings-grid">
        {kind !== "recurring" && (
          <NumberField
            label="本次一次性追加预算"
            value={extra}
            onChange={(v) => setExtra(v ?? 0)}
            max={1000000}
            help="可填 0；这笔钱与后续定投分开计算。"
          />
        )}
        {recurring && (
          <>
            <NumberField
              label="临时每日总预算"
              value={dailyBudget}
              max={1000000}
              onChange={(v) => setDailyBudget(v ?? 0)}
              help="这是替代原定投的总额，不是在原金额上再投一遍。"
            />
            <NumberField
              label="计划执行的扣款次数"
              suffix="次"
              step="1"
              value={days}
              min={1}
              max={366}
              onChange={(v) => setDays(v ?? 0)}
            />
          </>
        )}
        <label className="field">
          计划开始日期
          <input
            type="date"
            min={localDate()}
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setReviewOverride("");
            }}
          />
        </label>
      </div>
      {recurring && (
        <p className="budget-explanation">
          {extraDaily > 0
            ? `相比长期每日预算，额外增加 ${money(extraDaily)} / 次；${days} 次共多准备 ${money(yuan(cents(extraDaily) * days))}。`
            : "在原每日预算内重新分配，可以暂停超配类别并提高低配类别。"}{" "}
          扣款日按{settings.cadence === "weekdays" ? "工作日" : "自然日"}
          估算，不识别节假日或基金开放日。
        </p>
      )}
      {trading && (
        <p className="notice warning">
          你选择了包含卖出的方案。仅安排允许卖出的超配类别；先核对赎回费用和到账时间，资金实际到账后再买入。
        </p>
      )}
      <InvestmentRules p={p} settings={settings} onChange={setSettings} />
      {error && (
        <p role="alert" className="danger">
          {error}
        </p>
      )}
      {plan && (
        <>
          <div className="adjustment-result-heading">
            <div>
              <span>按当前市值测算</span>
              <h3>
                {plan.inBand
                  ? "方案后可回到容忍范围"
                  : "方案后仍有偏差，届时再复查"}
              </h3>
            </div>
            <strong>
              {current.max.toFixed(1)} → {plan.maxAfter.toFixed(1)}
              <small>最大偏差 / 个百分点</small>
            </strong>
          </div>
          <AdjustmentTable plan={plan} />
          <div className="daily-summary">
            <span>
              一次性追加预算 <strong>{money(plan.extra)}</strong>
            </span>
            <span>
              计划卖出{" "}
              <strong>
                {money(plan.rows.reduce((s, r) => s + r.sell, 0))}
              </strong>
            </span>
            <span>
              计划一次性买入{" "}
              <strong>{money(plan.rows.reduce((s, r) => s + r.buy, 0))}</strong>
            </span>
          </div>
          <div className="daily-summary">
            <span>
              一次性未安排 <strong>{money(plan.unallocatedOnce)}</strong>
            </span>
            {recurring && (
              <>
                <span>
                  每日实际安排{" "}
                  <strong>
                    {money(
                      yuan(
                        cents(plan.dailyBudget) - cents(plan.unallocatedDaily),
                      ),
                    )}
                  </strong>
                </span>
                <span>
                  期间每日预算合计{" "}
                  <strong>{money(yuan(cents(plan.dailyBudget) * days))}</strong>
                </span>
                <span>
                  每日未安排 <strong>{money(plan.unallocatedDaily)}</strong>
                </span>
              </>
            )}
          </div>
          {(plan.unallocatedOnce > 0 || plan.unallocatedDaily > 0) && (
            <p className="notice warning">
              有资金因限购、买入权限或目标缺口未能安排，保留为待投资余额。不会把受限类别的资金自动转投其他类别。
              {recurring
                ? `期间共未安排 ${money(yuan(cents(plan.unallocatedOnce) + cents(plan.unallocatedDaily) * days))}。`
                : ""}
            </p>
          )}
          {recurring && (
            <p className="field-note">
              {plan.firstInBand === null
                ? `按这份固定清单执行 ${days} 次，仍不能回到容忍范围。可以延长期限、修改额度，或比较追加和卖出方案。`
                : plan.firstInBand === 0
                  ? "一次性调整后已在范围内，继续执行期间仍需核对偏差。"
                  : `价格不变时，约第 ${plan.firstInBand} 次扣款后首次进入容忍范围；这不是实际完成日期预测。`}{" "}
              单日额度同时预留本次买入与定投；本月剩余额度保守地覆盖整个临时计划，不假设跨月恢复。
            </p>
          )}
          <label className="field adjustment-date">
            下次复查日期
            <input
              type="date"
              min={startDate}
              value={reviewOverride || plan.reviewDate}
              onChange={(e) => setReviewOverride(e.target.value)}
            />
          </label>
          <p className="field-note">
            {recurring
              ? "默认安排在预计扣款次数结束后复查，可按支付宝实际扣款日修改。到期先更新持仓，再决定恢复原定投或继续调整。"
              : "默认下一日复查；请按赎回到账、申购确认时间修改日期。"}{" "}
            测算忽略价格变化、手续费和成交差异，不会写入实际持仓。
          </p>
          {p.adjustment && (
            <label className="replace-plan">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              我已核对旧计划，同意用本方案替换
            </label>
          )}
          <div className="button-row">
            <button
              className="btn primary"
              disabled={blocked || (!!p.adjustment && !replace)}
              onClick={save}
            >
              保存临时计划，回首页
            </button>
            <CopyText key={JSON.stringify(plan)} text={adjustmentText(plan)} />
          </div>
          {blocked && (
            <p className="danger">
              请先核对最新持仓并解决保存问题，再保存这份计划。
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
