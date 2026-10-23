import { CASH_ID, type Portfolio } from "./model";
import { fullRebalance } from "./planning";
import type { Plan } from "./rebalance";
import type { ReviewMethod } from "./review";

export function reportText(p: Portfolio, plan: Plan, method: ReviewMethod) {
  const format = (n: number) => `¥${n.toFixed(2)}`;
  const trade = fullRebalance(p, plan);
  const rows =
    method === "trade"
      ? trade.map((r) => ({
          name: r.name,
          change: r.change,
          after: r.after,
          target: p.assets.find((a) => a.id === r.id)!.target,
          id: r.id,
        }))
      : plan.rows.map((r) => ({
          name: p.assets.find((a) => a.id === r.id)!.name,
          change: r.buy,
          after: r.after,
          target: r.target,
          id: r.id,
        }));
  return [
    "Portfolio Pilot · 本次复查方案",
    `持仓截至：${p.snapshot?.asOf ?? "未确认"}${p.snapshot?.estimated ? "（估算）" : ""}`,
    `方案：${method === "trade" ? "买卖调整" : "新增资金纠偏"}`,
    `本次新增资金：${format(p.budget)}`,
    `交易金额步长：${p.rounding} 元`,
    ...rows
      .filter((r) => r.id !== CASH_ID && (r.change || r.after))
      .map(
        (r) =>
          `${r.name}：${r.change < 0 ? "卖出" : r.change > 0 ? "买入" : "无需交易"}${r.change ? " " + format(Math.abs(r.change)) : ""}；调整后 ${format(r.after)} / ${plan.portfolioAfter ? ((r.after / plan.portfolioAfter) * 100).toFixed(1) : 0}%；目标 ${r.target}%`,
      ),
    `调整后待投资余额：${format(rows.find((r) => r.id === CASH_ID)?.after ?? 0)}`,
    "按已填写市值计算，未计费用、税费、限购和成交差异；执行前核对交易条件。",
    p.review?.rationale ? `配置理由：${p.review.rationale}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
