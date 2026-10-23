import type { Portfolio } from "./domain/model";
import {
  localDate,
  addMonths,
  reviewState,
  calendarText,
  validDate,
  type ReviewState,
} from "./domain/review";
import { deviation } from "./domain/planning";
import { downloadText } from "./storage/backup";
import { Panel, Icon, money } from "./components";

export function ReviewSettings({
  p,
  onChange,
}: {
  p: Portfolio;
  onChange: (p: Portfolio) => void;
}) {
  const state = reviewState(p);
  const update = (patch: Partial<ReviewState>) =>
    onChange({ ...p, review: { ...state, ...patch } });
  return (
    <details className="panel review-settings">
      <summary>复查安排与配置理由</summary>
      <div className="review-settings-grid">
        <label className="field">
          通常多久复查一次
          <select
            value={state.intervalMonths}
            onChange={(e) => {
              const intervalMonths = Number(
                e.target.value,
              ) as ReviewState["intervalMonths"];
              update({
                intervalMonths,
                nextDate: addMonths(
                  state.lastReviewedAt ?? p.strategy!.confirmedAt.slice(0, 10),
                  intervalMonths,
                ),
              });
            }}
          >
            <option value={3}>每 3 个月</option>
            <option value={6}>每 6 个月（默认安排）</option>
            <option value={12}>每 12 个月</option>
          </select>
        </label>
        <label className="field">
          下次复查日期
          <input
            type="date"
            value={state.nextDate}
            onChange={(e) => {
              const value = e.target.value;
              if (validDate(value)) update({ nextDate: value });
            }}
          />
        </label>
        <label className="field review-rationale">
          我的配置理由（选填）
          <textarea
            value={state.rationale}
            maxLength={1000}
            rows={3}
            placeholder="例如：这笔钱长期不用；比例按自己的承受能力确定。几个月后回来时，先看看这些条件有没有变化。"
            onChange={(e) => update({ rationale: e.target.value })}
          />
        </label>
      </div>
      <p className="field-note">
        默认半年检查一次，属于可修改的使用安排。到期先核对持仓，再判断是否需要交易；未完全纠偏时，下次检查会提前到最多
        3 个月后。
      </p>
    </details>
  );
}

export default function ReviewHome({
  p,
  onChange,
  onStart,
  onExport,
  onEdit,
}: {
  p: Portfolio;
  onChange: (p: Portfolio) => void;
  onStart: () => void;
  onExport: () => void;
  onEdit: () => void;
}) {
  const state = reviewState(p),
    due = state.nextDate <= localDate(),
    active = state.active;
  const latest = state.records[0],
    needsBackup =
      latest &&
      (!state.lastExportedAt ||
        Date.parse(state.lastExportedAt) < Date.parse(latest.completedAt));
  return (
    <>
      <section className={`panel review-hero ${due ? "review-due" : ""}`}>
        <div className="review-hero-copy">
          <span className="pill">
            {active
              ? "本次复查尚未结束"
              : due
                ? "到了复查时间"
                : "长期计划已保存"}
          </span>
          <h2>
            {active
              ? "接着完成上次的复查"
              : due
                ? "核对一次，看看是否需要调整"
                : "照常执行，几个月后再来"}
          </h2>
          <p>
            {active
              ? "持仓、资金和所选方案已保留，可以从上次的步骤继续。"
              : "平时按固定计划定投，到期更新各类市值，再决定是否需要再平衡。"}
          </p>
          <div className="review-date">
            <span>下次复查</span>
            <strong>{state.nextDate}</strong>
          </div>
          <p className="field-note">
            {state.lastReviewedAt
              ? `上次完成复查：${state.lastReviewedAt}`
              : "还没有完成过复查"}{" "}
            ·{" "}
            {p.snapshot
              ? `持仓截至 ${p.snapshot.asOf}${p.snapshot.estimated ? "（估算）" : ""}`
              : "尚未录入持仓"}
          </p>
          <div className="button-row">
            <button className="btn primary" onClick={onStart}>
              {active ? "继续本次复查" : "开始本次复查"}
              <Icon name="arrow" size={18} />
            </button>
            <button
              className="btn"
              onClick={() =>
                downloadText(
                  calendarText(state.nextDate),
                  "portfolio-review.ics",
                  "text/calendar;charset=utf-8",
                )
              }
            >
              添加到日历
            </button>
          </div>
        </div>
        <aside className="review-checklist">
          <strong>回来后，只做这三步</strong>
          <ol>
            <li>核对各类资产的当前市值</li>
            <li>填写这次准备追加的资金</li>
            <li>查看清单，保存本次结论</li>
          </ol>
          <p>复查时间是检查安排，是否交易由当时的偏差决定。</p>
        </aside>
      </section>
      {needsBackup && (
        <div className="notice review-backup">
          <Icon name="data" />
          <span>本次复查已保存。导出一份备份，下次或换设备时可以继续。</span>
          <button className="btn" onClick={onExport}>
            备份本次结果
          </button>
        </div>
      )}
      {latest && (
        <Panel title="上次复查结论">
          <div className="review-last">
            <div>
              <strong>{latest.summary}</strong>
              <p>
                {latest.completedAt.slice(0, 10)} ·{" "}
                {latest.after.estimated ? "估算持仓" : "已核对持仓"}
              </p>
            </div>
            <span>
              组合市值{" "}
              {money(latest.after.assets.reduce((s, a) => s + a.value, 0))}
            </span>
          </div>
          {deviation(p).breached && (
            <p className="field-note">
              上次记录后仍有类别超出范围，下一次安排已提前。实际是否需要继续调整，以复查时的最新市值为准。
            </p>
          )}
        </Panel>
      )}
      <ReviewSettings p={p} onChange={onChange} />
      {state.rationale && (
        <Panel title="当时为什么这样配置">
          <p className="review-note">{state.rationale}</p>
          <button className="text-button" onClick={onEdit}>
            资金期限或承受能力变了？重新评估配置
          </button>
        </Panel>
      )}
      {state.records.length > 0 && (
        <details className="panel review-history">
          <summary>历次复查 · {state.records.length} 次</summary>
          {state.records.map((r) => (
            <details key={r.id} className="review-record">
              <summary>
                {r.completedAt.slice(0, 10)} · {r.summary}
              </summary>
              <p className="field-note">
                下次安排 {r.nextDate} · 新增资金 {money(r.budget)} ·{" "}
                {r.after.estimated ? "调整后为估算" : "实际市值已核对"}
              </p>
              {r.rationale && (
                <p className="review-note">配置理由：{r.rationale}</p>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>类别</th>
                      <th>调整前</th>
                      <th>调整后</th>
                      <th>目标</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.after.assets.map((a) => (
                      <tr key={a.id}>
                        <td>{a.name}</td>
                        <td>
                          {money(
                            r.before.assets.find((b) => b.id === a.id)?.value ??
                              0,
                          )}
                        </td>
                        <td>{money(a.value)}</td>
                        <td>{a.target}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </details>
      )}
    </>
  );
}
