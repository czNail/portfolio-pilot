import { useState } from "react";
import {
  CASH_ID,
  cents,
  yuan,
  newId,
  totals,
  validate,
  type Portfolio,
  type Asset,
} from "./domain/model";
import {
  normaliseWeights,
  changeWeight,
  distributeUnits,
} from "./domain/input";
import { NumberField, Panel, Icon, money, colors } from "./components";
import { MixBar, ShareSlider } from "./AllocationControls";
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const core = new Set(["us", "cn", "gold", "bonds", CASH_ID]);
export default function HoldingsEditor({
  p,
  onSave,
  onCancel,
}: {
  p: Portfolio;
  onSave: (p: Portfolio) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(p),
    [mode, setMode] = useState<"amount" | "ratio">("amount"),
    [asOf, setAsOf] = useState(today());
  const [mix, setMix] = useState(
    normaliseWeights(
      p.assets.map((a) => a.value).some((v) => v > 0)
        ? p.assets.map((a) => a.value)
        : p.assets.map((a) => a.target),
    ),
  );
  const [note, setNote] = useState("");
  const total = totals(draft),
    issues = validate(draft);
  const update = (id: string, patch: Partial<Asset>) =>
    setDraft((d) => ({
      ...d,
      assets: d.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  const ratio = (weights: number[], amount: number) => {
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) {
      setNote("组合总额需为 0～1 万亿元。");
      return;
    }
    setNote("");
    const values = distributeUnits(weights, cents(amount));
    setMix(weights);
    setDraft((d) => ({
      ...d,
      assets: d.assets.map((a, i) => ({ ...a, value: yuan(values[i]) })),
    }));
  };
  const switchMode = (next: "amount" | "ratio") => {
    if (issues.length) return;
    if (next === "ratio" && total.invested > 0)
      setMix(normaliseWeights(draft.assets.map((a) => a.value)));
    setMode(next);
  };
  const add = (name: string) => {
    const next = [
      ...draft.assets,
      { id: newId(), name, value: 0, target: 0, shock: 40, monthlyLimit: null },
    ];
    setDraft({ ...draft, assets: next });
    setMix(normaliseWeights(next.map((a) => a.value)));
  };
  const dateValid =
    /^\d{4}-\d{2}-\d{2}$/.test(asOf) &&
    Number.isFinite(Date.parse(asOf)) &&
    new Date(asOf).toISOString().slice(0, 10) === asOf &&
    asOf <= today();
  return (
    <div className="holdings-workspace">
      <Panel
        title="更新当前持仓"
        description="打开支付宝，按类别填写最新市值。同类多只基金可直接输入 1200+3500.50，自动合计；未持有可留空。"
        action={
          <div className="segmented">
            <button
              className={mode === "amount" ? "selected" : ""}
              onClick={() => switchMode("amount")}
            >
              各类金额
            </button>
            <button
              className={mode === "ratio" ? "selected" : ""}
              onClick={() => switchMode("ratio")}
            >
              总额＋比例
            </button>
          </div>
        }
      >
        {mode === "ratio" && (
          <div className="total-input">
            <NumberField
              label="组合当前总金额"
              value={total.invested}
              emptyZero
              onChange={(v) => ratio(mix, v ?? 0)}
            />
            <p className="field-note">
              下面调整当前占比，金额自动分配；这不会改变长期目标。
            </p>
          </div>
        )}
        <div className={`holding-list ${mode === "ratio" ? "ratio-mode" : ""}`}>
          {draft.assets.map((a, i) => (
            <div key={a.id} className="holding-row">
              <div className="holding-label">
                <span className="asset-name">
                  <i style={{ background: colors[i % colors.length] }} />
                  {a.name}
                </span>
                <small>
                  {mode === "amount" &&
                  Number.isFinite(total.invested) &&
                  total.invested > 0
                    ? `${((a.value / total.invested) * 100).toFixed(1)}%`
                    : ""}
                </small>
              </div>
              {mode === "amount" ? (
                <NumberField
                  label={`${a.name}当前总市值`}
                  hideLabel
                  emptyZero
                  value={a.value}
                  onChange={(v) => update(a.id, { value: v ?? 0 })}
                />
              ) : (
                <ShareSlider
                  name={a.name}
                  label="当前占比"
                  value={mix[i]}
                  color={colors[i % colors.length]}
                  onChange={(v) =>
                    ratio(changeWeight(mix, i, v), total.invested)
                  }
                />
              )}
            </div>
          ))}
        </div>
        {Number.isFinite(total.invested) && (
          <>
            <MixBar p={draft} />
            <div className="holdings-total">
              <span>参与配置的组合合计</span>
              <strong>{money(total.invested)}</strong>
            </div>
          </>
        )}
        <p className="field-note">
          这里只录入投资组合市值。“待投资余额”仅指准备买入但尚未成交的零钱；已预留的生活现金不要计入组合。
        </p>
        <div className="snapshot-date">
          <label className="field">
            这些市值截至哪一天？
            <input
              type="date"
              value={asOf}
              max={today()}
              onChange={(e) => setAsOf(e.target.value)}
            />
          </label>
          <p className="field-note">
            请填写实际查询市值的日期；保存后将标记为你核对过的持仓。
          </p>
        </div>
        <details className="inline-details">
          <summary>
            另有不参与配置的备用金<span>选填</span>
          </summary>
          <NumberField
            label="备用金 / 生活安全垫"
            value={draft.reserve}
            emptyZero
            onChange={(v) => setDraft({ ...draft, reserve: v ?? 0 })}
          />
          <p className="field-note">
            不参与目标比例，仅用于全资产压力测算。已填入组合现金的金额不要重复填写。
          </p>
        </details>
        <details className="inline-details">
          <summary>
            管理其他资产类别<span>可选</span>
          </summary>
          <div className="button-row">
            {["港股", "海外债券", "其他资产"].map((name) => (
              <button
                className="btn small"
                key={name}
                disabled={
                  draft.assets.length >= 16 ||
                  draft.assets.some((a) => a.name === name)
                }
                onClick={() => add(name)}
              >
                <Icon name="plus" size={14} />
                {name}
              </button>
            ))}
          </div>
          {draft.assets
            .filter((a) => !core.has(a.id))
            .map((a) => (
              <div className="custom-asset" key={a.id}>
                <label className="field">
                  类别名称
                  <input
                    maxLength={40}
                    value={a.name}
                    onChange={(e) => update(a.id, { name: e.target.value })}
                  />
                </label>
                <button
                  className="text-button danger"
                  disabled={a.value !== 0 || a.target !== 0}
                  onClick={() => {
                    const assets = draft.assets.filter((x) => x.id !== a.id);
                    setDraft({
                      ...draft,
                      assets,
                      monthlyPlan: draft.monthlyPlan
                        ? {
                            ...draft.monthlyPlan,
                            assetIds: draft.monthlyPlan.assetIds.filter(
                              (id) => id !== a.id,
                            ),
                          }
                        : undefined,
                    });
                    setMix(normaliseWeights(assets.map((x) => x.value)));
                  }}
                >
                  移除
                </button>
              </div>
            ))}
          <p className="field-note">
            新增或移除类别后，需要重新确认目标比例。类别市值和目标都为零时才可移除。
          </p>
        </details>
        <details className="inline-details">
          <summary>
            本月剩余可买额度<span>选填</span>
          </summary>
          <p className="field-note">
            留空不限，0
            表示本月暂停。几个月后回来时请重新核对额度，不要沿用过期的限购信息；记录执行后会扣减。
          </p>
          <div className="limit-grid">
            {draft.assets
              .filter((a) => a.id !== CASH_ID)
              .map((a) => (
                <NumberField
                  key={a.id}
                  label={`${a.name}剩余可买额度`}
                  nullable
                  value={a.monthlyLimit}
                  onChange={(v) => update(a.id, { monthlyLimit: v })}
                />
              ))}
          </div>
        </details>
        {(issues.length > 0 || note || !dateValid) && (
          <div className="notice warning" role="alert">
            {[
              ...issues,
              note,
              !dateValid ? "请填写有效的持仓日期，且不能晚于今天。" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          </div>
        )}
        <div className="editor-actions">
          <button className="btn" onClick={onCancel}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={issues.length > 0 || !dateValid || !!note}
            onClick={() =>
              onSave({
                ...draft,
                snapshot: { asOf, estimated: mode === "ratio" },
              })
            }
          >
            <Icon name="check" size={17} />
            保存持仓
          </button>
        </div>
      </Panel>
    </div>
  );
}
