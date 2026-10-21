import { useState } from "react";
import { changeWeight } from "./domain/input";
import {
  confirmStrategy,
  recommend,
  riskChoices,
  scenarioRate,
  validProfile,
  type RiskProfile,
} from "./domain/strategy";
import type { Portfolio } from "./domain/model";
import { Icon, Panel, colors, money } from "./components";
import { ShareSlider } from "./AllocationControls";

const questions = [
  {
    key: "horizon",
    title: "这笔钱，预计多久后会用到？",
    note: "按最早可能需要动用本金的时间选择。备用金单独保留。",
  },
  {
    key: "reserve",
    title: "投资之外，留好了多少备用金？",
    note: "按能覆盖几个月必要生活开支估算，不计入这次投资组合。",
  },
  {
    key: "loss",
    title: "投入 10 万元，最多能接受多大的账面亏损？",
    note: "选一个仍能让你正常生活和坚持计划的幅度。",
  },
  {
    key: "reaction",
    title: "如果持仓明显下跌，你更可能怎么做？",
    note: "根据自己的实际反应选择；还没经历过时，选更谨慎的答案。",
  },
] as const;
const shortPct = (n: number) => `${Number(n.toFixed(2))}%`;
export function AllocationMix({
  p,
  weights,
}: {
  p: Portfolio;
  weights: number[];
}) {
  return (
    <div className="allocation-preview">
      <div
        className="mix-bar"
        role="img"
        aria-label={p.assets
          .map((a, i) => `${a.name} ${shortPct(weights[i])}`)
          .join("；")}
      >
        {p.assets.map(
          (a, i) =>
            weights[i] > 0 && (
              <span
                key={a.id}
                style={{
                  width: `${weights[i]}%`,
                  background: colors[i % colors.length],
                }}
              />
            ),
        )}
      </div>
      <div className="allocation-key">
        {p.assets.map((a, i) => (
          <div key={a.id}>
            <span className="asset-name">
              <i style={{ background: colors[i % colors.length] }} />
              {a.name}
            </span>
            <strong>{shortPct(weights[i])}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
export default function StrategyEditor({
  p,
  onSave,
  onCancel,
}: {
  p: Portfolio;
  onSave: (p: Portfolio) => void;
  onCancel: () => void;
}) {
  const [answers, setAnswers] = useState<Partial<RiskProfile>>(
    p.riskProfile ?? { region: "equal" },
  );
  const [step, setStep] = useState(p.riskProfile ? 4 : 0);
  const [custom, setCustom] = useState(!!p.strategy?.custom);
  const [weights, setWeights] = useState(() =>
    p.riskProfile && !p.strategy?.custom
      ? recommend(p.riskProfile, p.assets).weights
      : p.assets.map((a) => a.target),
  );
  const [band, setBand] = useState(p.strategy?.band ?? 5);
  const [ack, setAck] = useState(false);
  const profile = validProfile(answers) ? answers : undefined,
    recommendation = profile ? recommend(profile, p.assets) : null;
  const rate = scenarioRate(p.assets, weights),
    overRisk = !!profile && rate > profile.loss + 1e-7;
  const label = custom ? "自定策略" : (recommendation?.label ?? "自定策略");
  const next = () => {
    if (step === 3 && profile) {
      setWeights(recommend(profile, p.assets).weights);
      setCustom(false);
      setAck(false);
    }
    setStep(step + 1);
  };
  const region = (value: RiskProfile["region"]) => {
    const nextAnswers = { ...answers, region: value };
    setAnswers(nextAnswers);
    if (validProfile(nextAnswers)) {
      setWeights(recommend(nextAnswers, p.assets).weights);
      setCustom(false);
      setAck(false);
    }
  };
  const save = () => {
    onSave(
      confirmStrategy(p, weights, profile, label, custom || !profile, band),
    );
  };
  return (
    <div className="strategy-workspace">
      <div className="workflow-steps" aria-label="制定策略进度">
        {["资金期限", "备用金", "亏损承受", "下跌行为", "确认策略"].map(
          (text, i) => (
            <button
              key={text}
              disabled={i > step}
              aria-current={step === i ? "step" : undefined}
              className={step === i ? "active" : i < step ? "done" : ""}
              onClick={() => setStep(i)}
            >
              <span>{i < step ? <Icon name="check" size={14} /> : i + 1}</span>
              <small>{text}</small>
            </button>
          ),
        )}
      </div>
      {step < 4 ? (
        <Panel className="question-panel">
          <p className="eyebrow">风险评估 · {step + 1} / 4</p>
          <h2>{questions[step].title}</h2>
          <p className="question-note">{questions[step].note}</p>
          <fieldset className="choice-grid">
            <legend className="visually-hidden">{questions[step].title}</legend>
            {riskChoices[questions[step].key].map(([value, title, note]) => (
              <label
                className={`choice ${answers[questions[step].key] === value ? "selected" : ""}`}
                key={value}
              >
                <input
                  type="radio"
                  name={questions[step].key}
                  checked={answers[questions[step].key] === value}
                  onChange={() =>
                    setAnswers({ ...answers, [questions[step].key]: value })
                  }
                />
                <span>
                  <strong>{title}</strong>
                  <small>{note}</small>
                </span>
                <span className="radio-mark" />
              </label>
            ))}
          </fieldset>
          <div className="question-actions">
            <button
              className="btn"
              onClick={step > 0 ? () => setStep(step - 1) : onCancel}
            >
              {step > 0 ? "上一步" : "返回"}
            </button>
            <button
              className="btn primary"
              disabled={answers[questions[step].key] === undefined}
              onClick={next}
            >
              {step === 3 ? "查看建议比例" : "下一步"}
              <Icon name="arrow" size={17} />
            </button>
          </div>
          <button
            className="text-button skip-assessment"
            onClick={() => {
              setStep(4);
              setCustom(true);
              setWeights(p.assets.map((a) => a.target));
            }}
          >
            已有目标比例，直接设置
          </button>
        </Panel>
      ) : (
        <>
          <div className="strategy-result-grid">
            <Panel
              className="strategy-result"
              title={custom ? "设置自己的目标比例" : `建议采用${label}`}
              description={
                custom
                  ? "修改一项时，其余比例自动联动，合计始终为 100%。"
                  : recommendation?.description
              }
              action={
                <span className="pill">
                  {custom ? "待确认草稿" : "规则建议"}
                </span>
              }
            >
              <AllocationMix p={p} weights={weights} />
              {custom && (
                <div className="target-list">
                  {p.assets.map((a, i) => (
                    <div key={a.id} className="target-row">
                      <span className="asset-name">
                        <i style={{ background: colors[i % colors.length] }} />
                        {a.name}
                      </span>
                      <ShareSlider
                        name={a.name}
                        value={weights[i]}
                        color={colors[i % colors.length]}
                        onChange={(v) => {
                          setWeights(changeWeight(weights, i, v));
                          setAck(false);
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div className="strategy-tools">
                <button
                  className="text-button"
                  onClick={() => {
                    setCustom(!custom);
                    if (custom && recommendation)
                      setWeights(recommendation.weights);
                    setAck(false);
                  }}
                >
                  {custom && recommendation
                    ? "恢复建议比例"
                    : custom
                      ? "收起比例编辑"
                      : "微调目标比例"}
                </button>
                {!profile && (
                  <button className="text-button" onClick={() => setStep(0)}>
                    先做风险评估
                  </button>
                )}
              </div>
              {recommendation && (
                <details className="inline-details">
                  <summary>
                    权益内部如何分配？<span>可选</span>
                  </summary>
                  <fieldset className="region-options">
                    <legend className="visually-hidden">权益区域偏好</legend>
                    {riskChoices.region.map(([value, title, note]) => (
                      <label key={value}>
                        <input
                          type="radio"
                          name="region"
                          checked={answers.region === value}
                          onChange={() => region(value)}
                        />
                        <span>
                          <strong>{title}</strong>
                          <small>{note}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <p className="field-note">
                    区域偏好只改变美股与 A
                    股的分配，不提高权益总比例。模板以这两类权益为范围，不代表全球市场配置。
                  </p>
                </details>
              )}
              <details className="inline-details">
                <summary>
                  再平衡提醒阈值<span>默认 5 个百分点</span>
                </summary>
                <label className="field">
                  绝对偏差阈值
                  <select
                    value={band}
                    onChange={(e) => setBand(Number(e.target.value))}
                  >
                    {[3, 5, 8, 10].map((v) => (
                      <option key={v} value={v}>
                        {v} 个百分点
                      </option>
                    ))}
                  </select>
                </label>
                <p className="field-note">
                  每类资产的容忍偏差取“上述阈值”与“目标比例的
                  25%”中较小者。目标为零的类别仅使用绝对阈值。这是提醒规则，可按交易成本调整。
                </p>
              </details>
            </Panel>
            <div className="strategy-context">
              <Panel title="为什么是这个比例？">
                {recommendation ? (
                  <ul className="reason-list">
                    {recommendation.reasons.map((r) => (
                      <li key={r}>
                        <Icon name="check" size={17} />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="body-copy">
                    你选择自行设置目标比例。工具将围绕这组比例计算投入计划；尚未评估它与你的资金期限和风险承受能力是否匹配。
                  </p>
                )}
                {p.assets.some(
                  (a) => !["us", "cn", "gold", "bonds", "cash"].includes(a.id),
                ) && (
                  <p className="field-note">
                    规则模板将自定义类别的目标设为
                    0%，已有持仓会保留；请在微调时确认这些类别的长期目标。
                  </p>
                )}
                <button className="text-button" onClick={() => setStep(0)}>
                  重新回答问题
                </button>
              </Panel>
              <Panel
                className={
                  overRisk ? "scenario-card warning-card" : "scenario-card"
                }
                title="确认前，看看下跌情景"
              >
                <p>按这组目标比例投入 10 万元</p>
                <strong className="scenario-amount">
                  −{money((100000 * rate) / 100)}
                </strong>
                <span>假设组合下跌 {shortPct(rate)}</span>
                <details className="inline-details">
                  <summary>查看测算假设</summary>
                  <p>
                    {p.assets
                      .filter((_, i) => weights[i] > 0)
                      .map((a) => `${a.name}跌 ${a.shock}%`)
                      .join("、")}
                    ，同时发生。
                  </p>
                  <p>静态情景不是最大回撤预测，也不能保证损失上限。</p>
                </details>
                {overRisk && (
                  <p className="risk-alert">
                    这一情景超过你选择的 {profile!.loss}%
                    亏损承受幅度，建议降低风险资产比例。
                  </p>
                )}
              </Panel>
            </div>
          </div>
          <div className="strategy-confirm panel">
            <div>
              <strong>把这组比例保存为长期目标</strong>
              <p>
                日常投入会自动围绕目标计算。以后可随资金用途、期限或承受能力变化再调整。
              </p>
              {overRisk && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                  />
                  我理解这一情景超过自己填写的亏损承受幅度，仍采用此比例
                </label>
              )}
            </div>
            <div className="button-row">
              <button className="btn" onClick={onCancel}>
                暂不修改
              </button>
              <button
                className="btn primary"
                disabled={overRisk && !ack}
                onClick={save}
              >
                <Icon name="check" size={17} />
                确认并使用策略
              </button>
            </div>
          </div>
          <details className="method-note">
            <summary>配置规则与适用范围</summary>
            <p>
              这是本工具的简化规则模型（2026-10-v1），不是经过验证的投资适当性测评。先取资金期限、备用金、亏损意愿和下跌行为约束中更谨慎的档位，再从固定模板生成比例；若模板的当前压力情景超过所选亏损幅度，则逐档降低。美股与
              A
              股暂作为权益配置范围，债券假设为分散、以高质量债券为主的资产；高收益债和长久期债券需另行评估。
            </p>
            <p>
              短于一年或备用金不足 3
              个月时，模板优先保留现金。现金类别包含存款与现金等价物，它们的流动性和本金风险仍有差异。上述具体模板和比例由本工具设定，并非下述机构的推荐组合。
            </p>
            <a
              href="https://investor.vanguard.com/investor-resources-education/education/model-portfolio-allocation"
              target="_blank"
              rel="noreferrer"
            >
              参考：Vanguard 关于期限、风险意愿与承担能力的说明{" "}
              <Icon name="external" size={13} />
            </a>
          </details>
        </>
      )}
    </div>
  );
}
