import { useState } from "react";
import { Panel, NumberField, money, Modal, Icon } from "./components";
import { CASH_ID, cents, yuan, type Portfolio } from "./domain/model";
import {
  dailySettings,
  dailyAllocation,
  investmentRule,
  dailyIssues,
  planningSignature,
  type DailySettings,
  type AdjustmentPlan,
} from "./domain/daily";
import { calendarText, localDate, reviewState } from "./domain/review";
import { downloadText } from "./storage/backup";

export const kindNames = {
  recurring: "暂停 / 提高定投",
  append: "一次性追加",
  trade: "卖出并调仓",
  mixed: "组合调整",
};
export function CopyText({
  text,
  label = "复制清单",
}: {
  text: string;
  label?: string;
}) {
  const [fallback, setFallback] = useState(false),
    [copied, setCopied] = useState(false);
  return (
    <>
      <button
        className="btn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          } catch {
            setFallback(true);
          }
        }}
      >
        {copied ? "已复制" : label}
      </button>
      {fallback && (
        <Modal title={label} onClose={() => setFallback(false)}>
          <p>可长按或全选下面的内容复制。</p>
          <textarea
            className="report-copy"
            aria-label="清单文本"
            readOnly
            value={text}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button className="btn" onClick={() => setFallback(false)}>
            完成
          </button>
        </Modal>
      )}
    </>
  );
}
export function CalendarReminder({
  date,
  temporary = false,
}: {
  date: string;
  temporary?: boolean;
}) {
  const text = `${date}：${temporary ? "复查临时定投设置，决定恢复原计划还是继续调整" : "更新持仓，检查定投计划"}。https://cznail.github.io/portfolio-pilot/`;
  return (
    <div className="calendar-reminder">
      <div>
        <strong>{date} · 记得在手机日历设置提醒</strong>
        <p>
          数据仅保存在当前浏览器，网页关闭后不会提醒。导入后请在手机日历确认提醒已开启；日历不含财务金额。
        </p>
      </div>
      <div className="button-row">
        <button
          className="btn"
          onClick={() =>
            downloadText(
              calendarText(date, new Date(), temporary),
              "portfolio-review.ics",
              "text/calendar;charset=utf-8",
            )
          }
        >
          添加到手机日历
        </button>
        <CopyText text={text} label="复制提醒内容" />
      </div>
    </div>
  );
}
export function InvestmentRules({
  p,
  settings,
  onChange,
}: {
  p: Portfolio;
  settings: DailySettings;
  onChange: (s: DailySettings) => void;
}) {
  const update = (
    id: string,
    patch: Partial<ReturnType<typeof investmentRule>>,
  ) =>
    onChange({
      ...settings,
      rules: {
        ...settings.rules,
        [id]: { ...investmentRule(settings, id), ...patch },
      },
    });
  return (
    <details className="daily-rules">
      <summary>限购与操作权限 · 美股限购在这里填</summary>
      <p className="field-note">
        按类别汇总支付宝里各只基金的额度，可用加法。同类基金的额度只能合并用于该类别，实际买入时仍需逐只核对。
      </p>
      {p.assets
        .filter((a) => a.id !== CASH_ID)
        .map((a) => {
          const r = investmentRule(settings, a.id);
          return (
            <div className="daily-rule" key={a.id}>
              <strong>{a.name}</strong>
              <NumberField
                label={`${a.name}单日可买上限`}
                value={r.dailyLimit}
                nullable
                onChange={(v) => update(a.id, { dailyLimit: v })}
                help="0 表示暂停申购，留空表示未设限制"
              />
              <div className="rule-permissions">
                <label>
                  <input
                    type="checkbox"
                    checked={r.buy}
                    onChange={(e) => update(a.id, { buy: e.target.checked })}
                  />
                  允许买入
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={r.sell}
                    onChange={(e) => update(a.id, { sell: e.target.checked })}
                  />
                  选择卖出方案时允许卖出
                </label>
              </div>
              <label className="field">
                基金名称 / 限额备注（选填）
                <input
                  type="text"
                  value={r.note}
                  maxLength={120}
                  placeholder="例如：基金甲每天 100，基金乙每天 50"
                  onChange={(e) => update(a.id, { note: e.target.value })}
                />
              </label>
            </div>
          );
        })}
      <p className="field-note">
        单日上限同时约束当天的一次性买入和定投；本月剩余额度在“我的持仓”设置，本方案不会假设下月额度自动恢复。额度由你核对，本工具不获取支付宝实时限额。
      </p>
    </details>
  );
}
export function AdjustmentTable({ plan }: { plan: AdjustmentPlan }) {
  const recurring = plan.days > 0;
  return (
    <div className="table-scroll">
      <table className="daily-table">
        <thead>
          <tr>
            <th>类别</th>
            {recurring && (
              <>
                <th>原每日</th>
                <th>改为每日</th>
              </>
            )}
            <th>一次性操作</th>
            <th>测算后市值</th>
          </tr>
        </thead>
        <tbody>
          {plan.rows
            .filter(
              (r) => r.beforeDaily || r.daily || r.buy || r.sell || r.after,
            )
            .map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.name}</th>
                {recurring && (
                  <>
                    <td>{money(r.beforeDaily)}</td>
                    <td>
                      <strong>{r.daily === 0 ? "暂停" : money(r.daily)}</strong>
                      {r.daily > r.beforeDaily ? (
                        <small>
                          提高{" "}
                          {money(yuan(cents(r.daily) - cents(r.beforeDaily)))}
                        </small>
                      ) : r.daily < r.beforeDaily && r.daily > 0 ? (
                        <small>
                          降低{" "}
                          {money(yuan(cents(r.beforeDaily) - cents(r.daily)))}
                        </small>
                      ) : null}
                    </td>
                  </>
                )}
                <td>
                  {r.sell > 0 && (
                    <span className="danger">
                      卖出 {money(r.sell)}
                      <br />
                    </span>
                  )}
                  {r.buy > 0 && <span>买入 {money(r.buy)}</span>}
                  {!r.sell && !r.buy && "—"}
                </td>
                <td>{money(r.after)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
export function adjustmentText(plan: AdjustmentPlan) {
  return [
    "支付宝调整清单 · " + kindNames[plan.kind],
    `开始 ${plan.startDate}；复查 ${plan.reviewDate}`,
    ...(plan.days
      ? [`执行 ${plan.days} 个扣款日，每日总预算 ${money(plan.dailyBudget)}`]
      : []),
    ...plan.rows.map(
      (r) =>
        `${r.name}：${r.sell ? "卖出 " + money(r.sell) + "；" : ""}${r.buy ? "追加 " + money(r.buy) + "；" : ""}${plan.days ? `每日 ${money(r.beforeDaily)} → ${money(r.daily)}` : ""}`,
    ),
    `一次性未安排 ${money(plan.unallocatedOnce)}；每日未安排 ${money(plan.unallocatedDaily)}`,
    "市值不变的静态测算；执行前核对每只基金限购、手续费、赎回到账与实际扣款日。",
  ].join("\n");
}
export function ActiveAdjustment({
  p,
  onChange,
  onReview,
}: {
  p: Portfolio;
  onChange: (p: Portfolio) => void;
  onReview: () => void;
}) {
  const plan = p.adjustment!,
    [closing, setClosing] = useState(false);
  const changed = plan.signature !== planningSignature(p),
    due = plan.reviewDate <= localDate();
  return (
    <Panel
      title={due ? "临时计划到期了，先复查持仓" : "正在执行的临时调整"}
      description={`${kindNames[plan.kind]} · ${plan.startDate} 开始 · ${plan.reviewDate} 复查`}
      className="active-adjustment"
    >
      <p>
        这份清单只记录操作安排，不代表已在支付宝设置或成交。长期目标和原定投预算仍保留。
      </p>
      {changed && (
        <p className="notice warning" role="alert">
          持仓、比例或设置已变化，下面是保存时的旧清单。请重新核对后生成方案。
        </p>
      )}
      {plan.days > 0 && <p>执行 {plan.days} 个扣款日 · 每日总预算 {money(plan.dailyBudget)} · 实际安排 {money(yuan(cents(plan.dailyBudget) - cents(plan.unallocatedDaily)))}。这会替代原定投清单，不叠加执行。</p>}
      <AdjustmentTable plan={plan} />
      <p className="field-note">
        一次性未安排 {money(plan.unallocatedOnce)}
        {plan.days > 0
          ? ` · 每个扣款日未安排 ${money(plan.unallocatedDaily)}`
          : ""}
        。未安排资金保留为待投资余额，不转投其他类别。
      </p>
      <div className="button-row">
        <button className="btn primary" onClick={onReview}>
          核对持仓，重新评估
        </button>
        <CopyText key={plan.createdAt} text={adjustmentText(plan)} />
        <button className="text-button" onClick={() => setClosing(true)}>
          结束临时计划
        </button>
      </div>
      <CalendarReminder date={plan.reviewDate} temporary={plan.days > 0} />
      {closing && (
        <Modal title="结束临时计划" onClose={() => setClosing(false)}>
          <p>
            清除的是本工具中的临时安排。请先在支付宝核对并修改暂停或提高过的定投；工具无法替你恢复扣款。持仓不会自动改变。
          </p>
          <div className="button-row">
            <button className="btn" onClick={() => setClosing(false)}>
              继续保留
            </button>
            <button
              className="btn primary"
              onClick={() => {
                onChange({ ...p, adjustment: undefined });
                setClosing(false);
              }}
            >
              已了解，结束临时计划
            </button>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
export default function DailyWorkspace({
  p,
  onChange,
  onEdit,
  onReview,
}: {
  p: Portfolio;
  onChange: (p: Portfolio) => void;
  onEdit: () => void;
  onReview: () => void;
}) {
  const [editing, setEditing] = useState(!p.dailySettings),
    [draft, setDraft] = useState(() => dailySettings(p));
  const s = editing ? draft : dailySettings(p),
    issues = dailyIssues(s);
  const allocation = issues.length ? null : dailyAllocation(p, s);
  const text = allocation
    ? [
        "支付宝长期定投清单",
        `每个扣款日预算 ${money(s.budget)}；${s.cadence === "weekdays" ? "工作日估算（实际以基金开放日为准）" : "自然日安排（实际以平台支持为准）"}`,
        ...allocation.rows
          .filter((r) => r.target > 0)
          .map(
            (r) =>
              `${r.name}：${money(r.amount)} / 扣款日（目标 ${r.target}%）`,
          ),
        `每日未安排 ${money(allocation.unallocated)}`,
      ].join("\n")
    : "";
  return (
    <>
      <Panel
        title="每日定投，照着这份清单设置"
        description="在支付宝设置固定扣款金额；平时无需每天回来打卡。"
        className="daily-workspace"
        action={
          <button className="text-button" onClick={onEdit}>
            修改目标比例
          </button>
        }
      >
        {!p.dailySettings && (
          <div className="notice">
            先确认每日预算：当前金额由原月预算 ÷ 21 估算，尚未保存为每日设置。
          </div>
        )}
        {editing ? (
          <>
            <div className="daily-settings-grid">
              <NumberField
                label="每个扣款日总预算"
                value={draft.budget}
                max={1000000}
                onChange={(v) => setDraft({ ...draft, budget: v ?? 0 })}
                help="支持 100+50。固定日金额下，每月总额随实际扣款次数变化。"
              />
              <label className="field">
                扣款安排
                <select
                  value={draft.cadence}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cadence: e.target.value as DailySettings["cadence"],
                    })
                  }
                >
                  <option value="weekdays">工作日估算（跳过周末）</option>
                  <option value="calendar">每个自然日</option>
                </select>
              </label>
            </div>
            <InvestmentRules p={p} settings={draft} onChange={setDraft} />
          </>
        ) : (
          <div className="daily-budget-display">
            <div>
              <span>每个扣款日预算</span>
              <strong>{money(s.budget)}</strong>
              <small>
                {s.cadence === "weekdays"
                  ? "工作日安排 · 节假日与实际扣款日以平台为准"
                  : "自然日安排 · 以平台支持的扣款日为准"}
              </small>
            </div>
            <button
              className="btn"
              onClick={() => {
                setDraft(dailySettings(p));
                setEditing(true);
              }}
            >
              <Icon name="edit" size={16} />
              修改金额与限购
            </button>
          </div>
        )}
        {allocation && (
          <>
            <div className="daily-amount-grid">
              {allocation.rows
                .filter((r) => r.target > 0)
                .map((r) => (
                  <div className="daily-amount-card" key={r.id}>
                    <span>
                      {r.name}
                      <small>目标 {r.target}%</small>
                    </span>
                    <strong>
                      {money(r.amount)}
                      <small>/ 扣款日</small>
                    </strong>
                    {r.limited && (
                      <p className="danger">
                        受限购或买入权限约束，原分配为 {money(r.desired)}
                      </p>
                    )}
                    {investmentRule(s, r.id).note && (
                      <p>{investmentRule(s, r.id).note}</p>
                    )}
                  </div>
                ))}
            </div>
            <div className="daily-summary">
              <span>
                实际安排{" "}
                <strong>
                  {money(yuan(cents(s.budget) - cents(allocation.unallocated)))}
                </strong>
              </span>
              <span>
                每日未安排 <strong>{money(allocation.unallocated)}</strong>
              </span>
            </div>
            {allocation.unallocated > 0 && (
              <p className="notice warning">
                受限制的部分保留待投资，不会自动分给其他类别。本月剩余额度用完后，请先核对再继续买入。
              </p>
            )}
            <p className="field-note">
              {p.adjustment
                ? "上方临时计划执行期间，以临时清单为准。这里保留长期设置，不能叠加执行。"
                : "同类多只基金由你分配本类金额，逐只核对限购；类别合计额度不代表任意一只基金都能买到该金额。"}{" "}
              单日限额与剩余额度以最近一次填写为准。
            </p>
          </>
        )}
        {issues.length > 0 && (
          <p className="danger" role="alert">
            {issues.join(" ")}
          </p>
        )}
        <div className="button-row">
          {editing ? (
            <>
              <button
                className="btn primary"
                disabled={issues.length > 0}
                onClick={() => {
                  onChange({ ...p, dailySettings: draft });
                  setEditing(false);
                }}
              >
                保存每日定投设置
              </button>
              {p.dailySettings && (
                <button className="btn" onClick={() => setEditing(false)}>
                  取消
                </button>
              )}
            </>
          ) : (
            <>
              <CopyText key={text} text={text} />
              <button className="btn" onClick={onReview}>
                检查偏差 / 制定调整
              </button>
            </>
          )}
        </div>
      </Panel>
      {!p.adjustment && <CalendarReminder date={reviewState(p).nextDate} />}
    </>
  );
}
