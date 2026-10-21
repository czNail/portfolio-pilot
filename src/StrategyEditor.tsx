import { useState } from "react";
import {
  changeWeight,
  normaliseWeights,
  distributeUnits,
} from "./domain/input";
import {
  confirmStrategy,
  riskChoices,
  scenarioRate,
  validProfile,
  type RiskProfile,
} from "./domain/strategy";
import {
  BUDGET_MAX,
  CASH_ID,
  cents,
  yuan,
  type Portfolio,
} from "./domain/model";
import {
  recommendSelected,
  mixWarnings,
  type MixWarning,
} from "./domain/monthly";
import { Icon, NumberField, Panel, colors, money } from "./components";
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
  startAtSetup = false,
}: {
  p: Portfolio;
  onSave: (p: Portfolio) => void;
  onCancel: () => void;
  startAtSetup?: boolean;
}) {
  const [answers, setAnswers] = useState<Partial<RiskProfile>>(
    p.riskProfile ?? { region: "equal" },
  );
  const [step, setStep] = useState(p.monthlyPlan && !startAtSetup ? 4 : -1);
  const [budget, setBudget] = useState(p.monthlyPlan?.budget ?? 0);
  const [selected, setSelected] = useState(
    p.monthlyPlan?.assetIds ??
      p.assets
        .filter((a) => ["us", "cn", "gold", "bonds"].includes(a.id))
        .map((a) => a.id),
  );
  const [custom, setCustom] = useState(!!p.strategy?.custom);
  const [weights, setWeights] = useState(p.assets.map((a) => a.target));
  const [band, setBand] = useState(p.strategy?.band ?? 5),
    [ack, setAck] = useState(false);
  const profile = validProfile(answers) ? answers : undefined;
  const recommendation =
    profile && selected.length
      ? recommendSelected(profile, p.assets, selected)
      : null;
  const warnings = mixWarnings(p.assets, weights, profile),
    critical = warnings.some((w) => w.critical);
  const budgetValid =
    Number.isFinite(budget) &&
    budget > 0 &&
    budget <= BUDGET_MAX &&
    Math.abs(budget * 100 - Math.round(budget * 100)) < 0.0001;
  const chosen = p.assets.filter(
    (a) => a.id !== CASH_ID && selected.includes(a.id),
  );
  const label = custom ? "自定策略" : (recommendation?.label ?? "自定策略");
  const generate = () => {
    if (profile) {
      setWeights(recommendSelected(profile, p.assets, selected).weights);
      setCustom(false);
    } else {
      const values = normaliseWeights(chosen.map((a) => a.target));
      setWeights(
        p.assets.map((a) => {
          const i = chosen.findIndex((x) => x.id === a.id);
          return i < 0 ? 0 : values[i];
        }),
      );
      setCustom(true);
    }
    setAck(false);
    setStep(4);
  };
  const setupNext = () => {
    if (!budgetValid || !chosen.length) return;
    if (profile) {
      const unchanged =
        p.monthlyPlan &&
        selected.length === p.monthlyPlan.assetIds.length &&
        selected.every((id) => p.monthlyPlan!.assetIds.includes(id));
      if (unchanged) {
        setStep(4);
        setAck(false);
      } else generate();
    } else setStep(0);
  };
  const next = () => {
    if (step === 3) generate();
    else setStep(step + 1);
  };
  const toggle = (id: string) => {
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
    setAck(false);
  };
  const region = (value: RiskProfile["region"]) => {
    const next = { ...answers, region: value };
    setAnswers(next);
    if (validProfile(next)) {
      setWeights(recommendSelected(next, p.assets, selected).weights);
      setCustom(false);
      setAck(false);
    }
  };
  const updateWeight = (id: string, value: number) => {
    const next = changeWeight(
      chosen.map((a) => weights[p.assets.findIndex((x) => x.id === a.id)]),
      chosen.findIndex((a) => a.id === id),
      value,
    );
    setWeights(
      p.assets.map((a) => {
        const i = chosen.findIndex((x) => x.id === a.id);
        return i < 0 ? 0 : next[i];
      }),
    );
    setAck(false);
  };
  const amounts = budgetValid
    ? distributeUnits(weights, cents(budget))
    : p.assets.map(() => 0);
  const save = () => {
    const next = confirmStrategy(
      p,
      weights,
      profile,
      label,
      custom || !profile,
      band,
    );
    onSave({
      ...next,
      source: "external",
      budget: p.monthlyPlan ? p.budget : budget,
      monthlyPlan: { budget, assetIds: selected },
    });
  };
  return (
    <div className="strategy-workspace">
      <div className="setup-progress" aria-label="定投计划设置进度">
        {[
          ["预算与类别", -1],
          ["风险与比例", 0],
          ["确认每月计划", 4],
        ].map(([text, index]) => (
          <button
            key={text}
            className={
              step === -1
                ? index === -1
                  ? "active"
                  : ""
                : step < 4
                  ? index === 0
                    ? "active"
                    : ""
                  : index === 4
                    ? "active"
                    : ""
            }
            disabled={Number(index) > step}
            onClick={() => setStep(Number(index))}
          >
            {text}
          </button>
        ))}
      </div>
      {step === -1 ? (
        <Panel
          className="question-panel setup-panel"
          title="先确定每月投入预算"
          description="填写已经扣除生活费、备用金和预留现金后，每月可以持续投入的金额。"
        >
          <NumberField
            label="每月可定投金额"
            value={budget}
            emptyZero
            placeholder="例如 4,000"
            onChange={(v) => setBudget(v ?? 0)}
          />
          <p className="field-note">
            这笔预算会完整分配给选中的投资类别，工具不会再次划出现金。
          </p>
          {budget !== 0 && !budgetValid && (
            <div className="notice warning" role="alert">
              每月预算需大于零、不超过 100 万元，最多两位小数。
            </div>
          )}
          <fieldset className="asset-choice-grid">
            <legend>选择要定投的类别</legend>
            {p.assets
              .filter((a) => a.id !== CASH_ID)
              .map((a, i) => (
                <label
                  className={`asset-choice ${selected.includes(a.id) ? "selected" : ""}`}
                  key={a.id}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(a.id)}
                    onChange={() => toggle(a.id)}
                  />
                  <span className="asset-name">
                    <i style={{ background: colors[i % colors.length] }} />
                    {a.name}
                  </span>
                </label>
              ))}
          </fieldset>
          <p className="field-note">
            可以不选债券。选中表示允许配置，实际金额取决于比例；未选类别不会买入，集中风险会提示。
          </p>
          {selected.length > 0 && (
            <div className="selection-hints">
              {!selected.includes("bonds") && (
                <p>
                  <Icon name="info" size={16} />
                  未选择债券，后续会结合权益集中度和压力情景检查风险。
                </p>
              )}
              {selected.length === 1 && (
                <p>
                  <Icon name="info" size={16} />
                  只选一个类别，组合会集中承担这一类资产的风险。
                </p>
              )}
            </div>
          )}
          <div className="question-actions">
            <button className="btn" onClick={onCancel}>
              取消
            </button>
            <button
              className="btn primary"
              disabled={!budgetValid || !chosen.length}
              onClick={setupNext}
            >
              继续，确定比例
              <Icon name="arrow" size={17} />
            </button>
          </div>
          <button
            className="text-button skip-assessment"
            disabled={!budgetValid || !chosen.length}
            onClick={() => {
              const values = normaliseWeights(chosen.map((a) => a.target));
              setWeights(
                p.assets.map((a) => {
                  const i = chosen.findIndex((x) => x.id === a.id);
                  return i < 0 ? 0 : values[i];
                }),
              );
              setCustom(true);
              setAck(false);
              setStep(4);
            }}
          >
            我已有目标比例，直接设置
          </button>
        </Panel>
      ) : step < 4 ? (
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
            <button className="btn" onClick={() => setStep(step - 1)}>
              上一步
            </button>
            <button
              className="btn primary"
              disabled={answers[questions[step].key] === undefined}
              onClick={next}
            >
              {step === 3 ? "查看比例与月投入" : "下一步"}
              <Icon name="arrow" size={17} />
            </button>
          </div>
        </Panel>
      ) : (
        <>
          <div className="monthly-setup-summary">
            <div>
              <span>每月固定定投</span>
              <strong>{money(budget)}</strong>
            </div>
            <p>预算已扣除现金 · {chosen.map((a) => a.name).join(" / ")}</p>
            <button className="text-button" onClick={() => setStep(-1)}>
              修改预算或类别
            </button>
          </div>
          <div className="strategy-result-grid">
            <Panel
              title={custom ? "设置自己的定投比例" : `建议采用${label}比例`}
              description="比例仅针对投资组合，合计 100%，不含你已预留的现金。"
              action={<span className="pill">待确认</span>}
            >
              <AllocationMix
                p={{ ...p, assets: chosen }}
                weights={chosen.map(
                  (a) => weights[p.assets.findIndex((x) => x.id === a.id)],
                )}
              />
              {custom && (
                <div className="target-list">
                  {chosen.map((a) => (
                    <div className="target-row" key={a.id}>
                      <span className="asset-name">{a.name}</span>
                      <ShareSlider
                        name={a.name}
                        value={
                          weights[p.assets.findIndex((x) => x.id === a.id)]
                        }
                        onChange={(v) => updateWeight(a.id, v)}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div className="strategy-tools">
                <button
                  className="text-button"
                  onClick={() => {
                    if (custom && recommendation) {
                      setWeights(recommendation.weights);
                      setCustom(false);
                    } else setCustom(true);
                    setAck(false);
                  }}
                >
                  {custom && recommendation ? "恢复建议比例" : "微调定投比例"}
                </button>
                <button className="text-button" onClick={() => setStep(0)}>
                  {profile ? "重新评估风险" : "补充风险评估"}
                </button>
              </div>
              <div className="monthly-preview">
                <h3>照这个比例，每月这样投</h3>
                {chosen.map((a) => {
                  const i = p.assets.findIndex((x) => x.id === a.id);
                  return (
                    <div key={a.id}>
                      <span>
                        {a.name}
                        <small>{Number(weights[i].toFixed(2))}%</small>
                      </span>
                      <strong>{money(yuan(amounts[i]))}</strong>
                    </div>
                  );
                })}
                <div className="monthly-preview-total">
                  <span>每月合计</span>
                  <strong>{money(budget)}</strong>
                </div>
              </div>
              {profile &&
                selected.includes("us") &&
                selected.includes("cn") && (
                  <details className="inline-details">
                    <summary>权益区域偏好</summary>
                    <fieldset className="region-options">
                      <legend className="visually-hidden">区域偏好</legend>
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
                  </details>
                )}
              <details className="inline-details">
                <summary>再平衡提醒阈值</summary>
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
                  每类资产取此阈值与目标比例的 25%
                  中较小者。零目标类别仅使用绝对阈值。
                </p>
              </details>
            </Panel>
            <div className="strategy-context">
              <RiskMixWarnings warnings={warnings} />
              <Panel title="比例的依据">
                {recommendation ? (
                  <ul className="reason-list">
                    {recommendation.reasons.map((r) => (
                      <li key={r}>
                        <Icon name="info" size={16} />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="body-copy">
                    你正在自行设置比例。工具按比例计算月投入，并做集中度检查；尚未评估与你的风险承受能力是否匹配。
                  </p>
                )}
              </Panel>
              <Panel className="scenario-card" title="按这组比例持有 10 万元">
                <strong className="scenario-amount">
                  −{money((100000 * scenarioRate(p.assets, weights)) / 100)}
                </strong>
                <span>
                  同时下跌情景约{" "}
                  {Number(scenarioRate(p.assets, weights).toFixed(2))}%
                </span>
                <details className="inline-details">
                  <summary>测算假设</summary>
                  <p>
                    {p.assets
                      .filter((_, i) => weights[i] > 0)
                      .map((a) => `${a.name}跌 ${a.shock}%`)
                      .join("、")}
                    。这不是最大回撤或亏损上限。
                  </p>
                </details>
              </Panel>
            </div>
          </div>
          <div className="strategy-confirm panel">
            <div>
              <strong>确认每月预算、类别与比例</strong>
              <p>
                固定定投清单会长期保留。持仓偏离时，另到“再平衡指导”查看本月应该怎样调整分配。
              </p>
              {critical && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                  />
                  我已了解风险不匹配提示，仍选择采用这份计划
                </label>
              )}
            </div>
            <div className="button-row">
              <button className="btn" onClick={onCancel}>
                暂不修改
              </button>
              <button
                className="btn primary"
                disabled={!budgetValid || !chosen.length || (critical && !ack)}
                onClick={save}
              >
                <Icon name="check" size={17} />
                确认每月定投计划
              </button>
            </div>
          </div>
          <details className="method-note">
            <summary>规则与适用范围</summary>
            <p>
              固定模板只给出投资资产内部比例，不包含现金：稳健型为权益 15%、黄金
              5%、债券 80%；平衡型为 45% / 10% / 45%；成长型为 70% / 10% /
              20%。低承受幅度时以债券为谨慎参考；近期用款或安全垫不足会提示暂缓投入。根据你的选择去掉未选类别并归一化，删去债券可能显著提高组合风险，因此必须重新检查。
            </p>
            <p>
              比例与集中度阈值是本工具的简化规则，并非经过验证的适当性测评或安全线。债券以分散、高质量债券为假设；黄金不是现金等价物；大类数量不能识别基金底层重叠。
              <a
                href="https://investor.vanguard.com/investor-resources-education/education/model-portfolio-allocation"
                target="_blank"
                rel="noreferrer"
              >
                参考：Vanguard 关于资产配置与风险承担能力的说明。
              </a>
            </p>
          </details>
        </>
      )}
    </div>
  );
}
export function RiskMixWarnings({ warnings }: { warnings: MixWarning[] }) {
  return (
    <Panel title="风险与分散检查" className="mix-warnings">
      {warnings.length ? (
        warnings.map((w) => (
          <div
            key={w.code}
            className={w.critical ? "mix-warning critical" : "mix-warning"}
          >
            <Icon name="info" size={18} />
            <div>
              <strong>{w.title}</strong>
              <p>{w.detail}</p>
            </div>
          </div>
        ))
      ) : (
        <p className="field-note">
          未触发当前规则的集中度提醒。仍需核对基金底层持仓重叠、信用、汇率和流动性风险。
        </p>
      )}
    </Panel>
  );
}
