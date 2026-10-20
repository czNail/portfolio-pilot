import { cents, yuan, validate, type Fund, type Portfolio } from './model';
export interface Execution { amount: number; days: number; }
export interface FundPlan { id: string; amount: number; capacity: number; execution: Execution[]; reason: string; }
export interface CategoryPlan { id: string; current: number; buy: number; targetValue: number; beforeWeight: number; afterWeight: number; }
export interface Plan { budget: number; spent: number; remainder: number; investedAfter: number; funds: FundPlan[]; categories: CategoryPlan[]; iterations: number; }
interface Limit { step: number; minUnits: number; dailyUnits: number; maxUnits: number; days: number; }
function limits(f: Fund, p: Portfolio): Limit {
  const step = cents(f.step), budgetUnits = Math.floor(cents(p.budget)/step);
  const minUnits = Math.max(1,Math.ceil(cents(f.minimum)/step));
  const dailyUnits = f.dailyLimit === null ? budgetUnits : Math.min(budgetUnits,Math.floor(cents(f.dailyLimit)/step));
  const maxUnits = f.paused || dailyUnits < minUnits ? 0 : Math.min(budgetUnits,dailyUnits*p.days,f.monthlyLimit === null ? budgetUnits : Math.floor(cents(f.monthlyLimit)/step));
  return {step,minUnits,dailyUnits,maxUnits,days:p.days};
}
// 可执行的月金额为每天 [最低额,日上限] 区间的并集；寻找下一个可执行总额。
function nextUnits(current: number, l: Limit): number | null {
  if (current >= l.maxUnits) return null;
  let best = Infinity;
  for (let d=1;d<=l.days;d++) {
    const n = Math.max(current+1,d*l.minUnits);
    if (n<=Math.min(l.maxUnits,d*l.dailyUnits)) best=Math.min(best,n);
  }
  return Number.isFinite(best)?best:null;
}
function capacityUnits(l: Limit): number {
  let best=0;
  for(let d=1;d<=l.days;d++) {
    const n=Math.min(l.maxUnits,d*l.dailyUnits);
    if(n>=d*l.minUnits)best=Math.max(best,n);
  }
  return best;
}
function execution(units: number, l: Limit): Execution[] {
  if (!units) return [];
  const days = Math.min(l.days,Math.floor(units/l.minUnits));
  if(days<1 || units>days*l.dailyUnits) throw new Error('无法形成满足限额的执行安排。');
  const low=Math.floor(units/days),extra=units%days;
  const r: Execution[]=[];
  if(extra)r.push({amount:yuan((low+1)*l.step),days:extra});
  if(days-extra)r.push({amount:yuan(low*l.step),days:days-extra});
  return r;
}
export function rebalance(p: Portfolio): Plan {
  const errors=validate(p); if(errors.length)throw new Error(errors.join('\n'));
  const budget=cents(p.budget), total=p.funds.reduce((s,f)=>s+cents(f.value),0);
  const current=p.categories.map(c=>p.funds.filter(f=>f.categoryId===c.id).reduce((s,f)=>s+cents(f.value),0));
  const targets=p.categories.map(c=>(total+budget)*c.target/100);
  const categoryBuy=current.map(()=>0);
  const state=p.funds.map(f=>({fund:f,cat:p.categories.findIndex(c=>c.id===f.categoryId),limit:limits(f,p),units:0,next:null as number|null}));
  for(const s of state)s.next=nextUnits(0,s.limit);
  let available=budget,iterations=0;
  while(available>0) {
    let best=-1,bestGain=-Infinity,bestFair=Infinity;
    for(let i=0;i<state.length;i++) {
      const s=state[i]; if(s.next===null)continue;
      const amount=(s.next-s.units)*s.limit.step;
      const deficit=targets[s.cat]-current[s.cat]-categoryBuy[s.cat];
      // 不买入已超配的大类，也不因最小申购额跨过满额投入时的目标。
      if(amount>available || amount>deficit+1e-6)continue;
      const gain=2*deficit-amount; // 每单位资金带来的平方缺口改善。
      const fairness=yuan(s.next*s.limit.step)/s.fund.weight;
      if(gain>bestGain+1e-6 || (Math.abs(gain-bestGain)<1e-6 && fairness<bestFair-1e-9)) {best=i;bestGain=gain;bestFair=fairness;}
    }
    if(best<0)break;
    const s=state[best],next=s.next!;
    const cost=(next-s.units)*s.limit.step;
    s.units=next;s.next=nextUnits(s.units,s.limit);
    categoryBuy[s.cat]+=cost;available-=cost;iterations++;
  }
  const spent=budget-available,after=total+spent;
  return {budget:yuan(budget),spent:yuan(spent),remainder:yuan(available),investedAfter:yuan(after),iterations,
    funds:state.map(s=>{
      const amount=s.units*s.limit.step,capacity=capacityUnits(s.limit)*s.limit.step;
      let reason='已分配';
      if(!amount)reason=s.fund.paused?'暂停申购':capacity===0?'额度或最低申购额不满足':targets[s.cat]<=current[s.cat]?'所属类别已超配或目标为零':'预算、目标缺口或购买步长限制';
      return {id:s.fund.id,amount:yuan(amount),capacity:yuan(capacity),execution:execution(s.units,s.limit),reason};
    }),
    categories:p.categories.map((c,i)=>({id:c.id,current:yuan(current[i]),buy:yuan(categoryBuy[i]),targetValue:yuan(targets[i]),beforeWeight:total?current[i]/total*100:0,afterWeight:after?(current[i]+categoryBuy[i])/after*100:0})),
  };
}
export function stress(p: Portfolio, plan?: Plan) {
  const errors=validate(p);if(errors.length)throw new Error(errors.join('\n'));
  const fundTotal=p.funds.reduce((s,f)=>s+cents(f.value),0);
  const rows=p.categories.map(c=>{
    const current=p.funds.filter(f=>f.categoryId===c.id).reduce((s,f)=>s+cents(f.value),0);
    const buy=plan?cents(plan.categories.find(x=>x.id===c.id)?.buy||0):0;
    return {name:c.name,value:yuan(current+buy),shock:c.shock,loss:yuan(current+buy)*c.shock/100};
  });
  rows.push({name:'存款 / 现金',value:p.cash+(plan?.remainder||0),shock:p.cashShock,loss:(p.cash+(plan?.remainder||0))*p.cashShock/100});
  rows.push({name:'债券',value:p.bonds,shock:p.bondShock,loss:p.bonds*p.bondShock/100});
  const total=yuan(fundTotal)+p.cash+p.bonds+(plan?.budget||0),loss=rows.reduce((s,r)=>s+r.loss,0),rate=total?loss/total*100:0;
  return {rows,total,loss,rate,remaining:total-loss,warning:total>0&&rate>p.threshold};
}
