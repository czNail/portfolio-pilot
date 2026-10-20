export interface Category { id: string; name: string; target: number; shock: number; }
export interface Fund {
  id: string; name: string; categoryId: string; value: number;
  dailyLimit: number | null; monthlyLimit: number | null;
  minimum: number; step: number; weight: number; paused: boolean;
}
export interface Portfolio {
  version: 1; demo: boolean; cash: number; bonds: number; budget: number; days: number;
  threshold: number; cashShock: number; bondShock: number;
  categories: Category[]; funds: Fund[];
}
export const MONEY_MAX = 1_000_000_000;
export const BUDGET_MAX = 1_000_000;
export const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);
export const yuan = (n: number) => n / 100;
export function newId(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }
export function emptyPortfolio(): Portfolio {
  return { version: 1, demo: false, cash: 0, bonds: 0, budget: 4000, days: 20, threshold: 40, cashShock: 0, bondShock: 10,
    categories: [
      { id: 'us', name: '美股', target: 42, shock: 60 },
      { id: 'cn', name: 'A 股', target: 45, shock: 60 },
      { id: 'gold', name: '黄金', target: 13, shock: 20 },
    ], funds: [] };
}
// 演示数据与真实账户无关，不包含任何真实基金代码或个人资产。
export function demoPortfolio(): Portfolio {
  return { ...emptyPortfolio(), demo: true, cash: 100000, bonds: 20000, funds: [
    {id:'demo-1',name:'美股基金 A',categoryId:'us',value:8000,dailyLimit:100,monthlyLimit:null,minimum:10,step:10,weight:2,paused:false},
    {id:'demo-2',name:'美股基金 B',categoryId:'us',value:4000,dailyLimit:10,monthlyLimit:null,minimum:10,step:10,weight:1,paused:false},
    {id:'demo-3',name:'A 股基金 A',categoryId:'cn',value:15000,dailyLimit:null,monthlyLimit:null,minimum:10,step:10,weight:1,paused:false},
    {id:'demo-4',name:'黄金基金 A',categoryId:'gold',value:5000,dailyLimit:null,monthlyLimit:null,minimum:10,step:10,weight:1,paused:false},
  ] };
}
export function validate(p: Portfolio): string[] {
  const issues: string[] = [];
  const money = (n: number, label: string, max = MONEY_MAX) => {
    if (!Number.isFinite(n) || n < 0 || n > max || Math.abs(n * 100 - Math.round(n * 100)) > .0001) issues.push(`${label}应为 0～${max.toLocaleString()} 元，最多两位小数。`);
  };
  money(p.cash,'存款'); money(p.bonds,'债券'); money(p.budget,'每月预算',BUDGET_MAX);
  if (!Number.isInteger(p.days) || p.days < 1 || p.days > 31) issues.push('可执行日应为 1～31 的整数。');
  for (const [n, label] of [[p.threshold,'预警阈值'],[p.cashShock,'存款跌幅'],[p.bondShock,'债券跌幅']] as const) if (!Number.isFinite(n) || n < 0 || n > 100) issues.push(`${label}应在 0～100% 之间。`);
  if (p.categories.length < 1 || p.categories.length > 8) issues.push('资产类别数量应为 1～8 个。');
  const categoryIds = new Set(p.categories.map(c=>c.id));
  if (categoryIds.size !== p.categories.length) issues.push('类别标识不能重复。');
  let total = 0;
  for (const c of p.categories) {
    if (!c.name.trim() || c.name.length > 40) issues.push('类别名称应为 1～40 个字符。');
    if (!Number.isFinite(c.target) || c.target < 0 || c.target > 100 || Math.abs(c.target*100-Math.round(c.target*100)) > .0001) issues.push(`${c.name || '类别'}的目标比例应在 0～100% 之间，最多两位小数。`);
    if (!Number.isFinite(c.shock) || c.shock < 0 || c.shock > 100) issues.push(`${c.name || '类别'}的情景跌幅应在 0～100% 之间。`);
    total += c.target;
  }
  if (Math.abs(total-100) > .00001) issues.push(`基金目标比例合计为 ${Number(total.toFixed(2))}%，需要等于 100%。`);
  if (p.funds.length > 40) issues.push('最多支持 40 只基金。');
  if (new Set(p.funds.map(f=>f.id)).size !== p.funds.length) issues.push('基金标识不能重复。');
  for (const f of p.funds) {
    const name = f.name || '未命名基金';
    if (!f.name.trim() || f.name.length > 80) issues.push('基金名称应为 1～80 个字符。');
    if (!categoryIds.has(f.categoryId)) issues.push(`${name}没有有效的资产类别。`);
    money(f.value,`${name}市值`); money(f.minimum,`${name}最低申购额`);
    if (f.dailyLimit !== null) money(f.dailyLimit,`${name}日限额`);
    if (f.monthlyLimit !== null) money(f.monthlyLimit,`${name}月限额`);
    if (!Number.isFinite(f.step) || !Number.isInteger(f.step) || f.step < 1 || f.step > BUDGET_MAX) issues.push(`${name}的购买步长应为 1～1,000,000 元的整数。`);
    if (!Number.isInteger(f.weight) || f.weight < 1 || f.weight > 100) issues.push(`${name}的分配权重应为 1～100 的整数。`);
  }
  return [...new Set(issues)];
}
export function totals(p: Portfolio) {
  const invested = yuan(p.funds.reduce((sum,f)=>sum+cents(f.value),0));
  return { invested, total: invested + p.cash + p.bonds };
}
