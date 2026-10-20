import type {ReactNode} from 'react';

function Help({title,children}:{title:string;children:ReactNode}){
  return <details className="usage-help"><summary>{title}<span>展开说明</span></summary><div className="usage-help-content">{children}</div></details>;
}

export function QuickStart(){
  return <aside className="quick-start" aria-label="使用顺序"><strong>第一次用</strong><p>填当前金额 → 调目标配比 → 看本次投入安排。滑条右侧的数字也能直接修改。</p></aside>;
}

export function HoldingHelp(){
  return <Help title="这里填什么？"><p><strong>填现在值多少钱。</strong> 把同一类股票、基金的当前市值相加，例如几只美股基金合计填在“美股”；尚未持有的类别留空即可。金额统一折合成人民币。</p><p><strong>只知道大概比例？</strong> 选择“总额＋滑条”，先填总金额，再拖动各类占比。滑条会重新分配当前金额，适合粗略估算；已有准确金额时用“各类金额”。</p><p><strong>现金与备用金怎么分？</strong> 准备参与这套目标配置的钱放在“现金”；单独保留、不参与配置的钱放在“备用金”。同一笔钱只填一处，备用金仍计入全资产风险测算。</p></Help>;
}

export function TargetHelp(){
  return <Help title="目标比例怎么用？"><p>这里表示你希望长期保持的资产结构。当前比例是“现在的样子”，目标比例是“希望的样子”，两者可以不同。页面初始比例仅供演示，需要按自己的计划调整。</p><p>拖动一项时，其余项会自动分配剩余比例；没有计划配置的类别可设为 0%。点“沿用当前配比”，会把当前实际比例复制为目标。</p><p>修改目标只会更新计算建议，不会交易或改变已录入的持仓金额。</p></Help>;
}

export function PlanHelp(){
  return <Help title="怎么看计划？需要取钱时怎么办？"><dl><dt>这笔钱从哪里来？</dt><dd>工资等新投入选“外部新增资金”；钱已填在“现金”里，选“使用组合中的现金”；从单独留出的备用金拿来投资，选“从备用金转入组合”，避免重复统计。</dd><dt>买入金额与比例怎么看？</dt><dd>按“本次安排”查看各类要买多少，再对照“安排后占比”和“目标”。这是按当前价格估算的一次计划，实际买入后，需要自行更新当前金额；导出计划只下载表格，不会下单。</dd><dt>为什么暂不追加，或还有现金？</dt><dd>这次优先补足低配类别。某类已经够多、达到可选额度或不足一个取整档位时，可能暂不追加；剩余预算保留为现金。只靠新增资金，未必能一次达到目标比例。</dd><dt>多久检查一次？</dt><dd>每次准备投入时更新市值、查看计划即可。目标比例按自己的长期计划复查，小幅波动不必频繁交易。</dd><dt>如果需要取钱出来？</dt><dd>预留支出可按用途使用单独的备用金。若要从投资组合提款，一般优先减持超配类别，并按取钱后的剩余总额看比例；已经平衡时，按比例取出可保持结构。提前确定的用钱需求应预留流动性，执行前核对赎回费用与到账时间。长期持续提款，还需重新评估配置和提款规模。</dd></dl><p className="help-sources">当前计算仅支持投入，尚不生成卖出或提款计划。<a href="https://www.vanguard.co.uk/professional/vanguard-365/investment-knowledge/portfolio-construction/when-multi-asset-investors-should-rebalance" target="_blank" rel="noreferrer">再平衡原理参考 Vanguard ↗</a></p></Help>;
}

export function RiskHelp(){
  return <Help title="风险测算怎么用？"><p><strong>先填金额，再试情景。</strong> 在“配置与定投”录入资产后，拖动各类假设跌幅。例如某类资产有 1 万元，设为下跌 30%，对应假设损失 3,000 元。</p><p><strong>看全部资产承受的损失。</strong> 所有类别按你设定的跌幅同时计算，损失率以组合和备用金合计为分母。上方可切换当前持仓与本次投入安排后的结果。</p><p><strong>预警线是你设定的提醒标准。</strong> 例如设为 40%，表示这一情景的全资产损失超过 40% 时提醒你。它不会限制真实跌幅，也不会自动止损；未触线仍可能有更大的实际损失。</p><p>备用金减少后，即使投资持仓没变，现金缓冲也会变少，建议再看一次全资产风险。</p></Help>;
}

export function BackupHelp(){
  return <Help title="自动保存、备份和导出计划有什么区别？"><dl><dt>自动保存</dt><dd>方便在同一设备、同一浏览器继续使用。换浏览器或设备不会自动同步，清理网站数据可能丢失记录。</dd><dt>JSON 备份</dt><dd>保存完整配置，换设备时在这里导入。导入会替换当前配置，建议先导出当前版本。备份含个人资产金额，请自行妥善保管。</dd><dt>导出计划</dt><dd>在“配置与定投”中下载 CSV，方便用表格查看本次安排；它不包含完整设置，不能用来恢复配置。</dd></dl></Help>;
}
