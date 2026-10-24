import type { Portfolio } from "./domain/model";
import { monthlyAllocation, monthlyReady, mixWarnings } from "./domain/monthly";
import { Panel, Icon, money } from "./components";
import { AllocationMix, RiskMixWarnings } from "./StrategyEditor";
import { downloadText } from "./storage/backup";
export default function MonthlyDashboard({
  p,
  onEdit,
  onRebalance,
  onHoldings,
}: {
  p: Portfolio;
  onEdit: (setup: boolean) => void;
  onRebalance: () => void;
  onHoldings: () => void;
}) {
  if (!monthlyReady(p))
    return (
      <section className="welcome-card panel">
        <div className="welcome-copy">
          <span className="pill">先定比例，再设置每日投入</span>
          <h2>
            把每日定投，
            <br />
            设置得清清楚楚。
          </h2>
          <p>
            先确定预算和目标比例，生成可以照着支付宝设置的每日清单。已有每月预算也可以沿用。
          </p>
          <button className="btn primary" onClick={() => onEdit(true)}>
            制定每月定投计划
            <Icon name="arrow" size={18} />
          </button>
        </div>
        <div className="welcome-steps">
          <div>
            <span>01</span>
            <div>
              <strong>每月能投入多少钱</strong>
              <p>只填可持续投入的净预算，不再重复留现金</p>
            </div>
          </div>
          <div>
            <span>02</span>
            <div>
              <strong>选类别，定比例</strong>
              <p>债券等类别可选，集中与风险不匹配会提示</p>
            </div>
          </div>
          <div>
            <span>03</span>
            <div>
              <strong>定投与再平衡分别指导</strong>
              <p>平时固定扣款，偏离时选择追加、卖出或修改定投</p>
            </div>
          </div>
        </div>
      </section>
    );
  const monthly = monthlyAllocation(p),
    active = p.assets.filter((a) => a.target > 0),
    warnings = mixWarnings(
      p.assets,
      p.assets.map((a) => a.target),
      p.riskProfile,
    );
  const exportMonthly = () => {
    const quote = (s: string) =>
      '"' +
      (/^[\s]*[=+\-@]/.test(s) ? "'" : "") +
      s.replaceAll('"', '""') +
      '"';
    downloadText(
      "\uFEFF" +
        [
          ["类别", "目标比例%", "每月定投金额"],
          ...monthly.rows.map((r) => [
            r.name,
            String(r.target),
            r.amount.toFixed(2),
          ]),
        ]
          .map((row) => row.map(quote).join(","))
          .join("\r\n"),
      "monthly-investment.csv",
      "text/csv;charset=utf-8",
    );
  };
  return (
    <>
      <div className="monthly-hero">
        <div>
          <span>我的每月定投预算</span>
          <strong>
            {money(monthly.budget)}
            <small>/ 月</small>
          </strong>
          <p>已经扣除现金 · 全部分配到所选投资类别</p>
        </div>
        <button className="btn" onClick={() => onEdit(true)}>
          <Icon name="edit" size={16} />
          调整预算与类别
        </button>
      </div>
      <div className="plan-layout">
        <Panel
          title="每月固定这样投"
          description="按已确认的目标比例分配，不随当前持仓自动改变。"
          action={
            <button className="text-button" onClick={exportMonthly}>
              <Icon name="download" size={16} />
              导出清单
            </button>
          }
        >
          <div className="monthly-amount-list">
            {monthly.rows.map((r) => (
              <div className="monthly-amount-row" key={r.id}>
                <div>
                  <strong>{r.name}</strong>
                  <span>目标占比 {Number(r.target.toFixed(2))}%</span>
                  {r.limited && (
                    <small className="danger">
                      超过当前填写的剩余可买额度，请先核对交易限制
                    </small>
                  )}
                </div>
                <strong>
                  {money(r.amount)}
                  <small>/ 月</small>
                </strong>
              </div>
            ))}
          </div>
          <div className="monthly-total">
            <span>每月合计</span>
            <strong>{money(monthly.budget)}</strong>
          </div>
          <p className="field-note">
            金额精确分配到分，合计始终等于月预算。相同大类下的具体基金由你选择；多只基金可能持仓重叠。
          </p>
          <div className="monthly-next">
            <Icon name="plan" size={22} />
            <div>
              <strong>到了复查时间，看看是否需要调整</strong>
              <p>
                复查时先核对市值，再填写本次可追加资金。平时照常执行固定计划，无需每月回来记录。
              </p>
              <button className="btn primary" onClick={onRebalance}>
                查看再平衡指导
                <Icon name="arrow" size={17} />
              </button>
            </div>
          </div>
        </Panel>
        <aside className="plan-sidebar">
          <Panel
            title="投资组合目标比例"
            action={
              <button className="text-button" onClick={() => onEdit(false)}>
                调整比例
              </button>
            }
          >
            <AllocationMix
              p={{ ...p, assets: active }}
              weights={active.map((a) => a.target)}
            />
            <p className="field-note">
              预留现金在投资组合之外，不参与这里的 100%。
            </p>
          </Panel>
          <RiskMixWarnings warnings={warnings} />
        </aside>
      </div>
      <div className="panel monthly-maintenance">
        <div>
          <strong>下次复查时，再集中核对持仓</strong>
          <p>
            这份固定计划持续保留。按首页安排复查即可；长期月预算不会因一次再平衡而清零。
          </p>
        </div>
        <button className="btn" onClick={onHoldings}>
          更新持仓
        </button>
      </div>
    </>
  );
}
