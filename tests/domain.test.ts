import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyPortfolio,demoPortfolio,validate,cents,type Portfolio,type Fund} from '../src/domain/model';
import {rebalance,stress} from '../src/domain/rebalance';
import {envelope,parseBackup} from '../src/storage/backup';
const fund=(patch:Partial<Fund>={}):Fund=>({id:'f',name:'测试基金',categoryId:'us',value:0,dailyLimit:null,monthlyLimit:null,minimum:1,step:1,weight:1,paused:false,...patch});
const one=(patch:Partial<Portfolio>={}):Portfolio=>({...emptyPortfolio(),categories:[{id:'us',name:'股票',target:100,shock:60}],funds:[fund()],...patch});
function invariant(p:Portfolio){
  const plan=rebalance(p);
  assert.equal(cents(plan.spent)+cents(plan.remainder),cents(p.budget));
  assert.ok(plan.remainder>=0);
  for(const f of p.funds){
    const row=plan.funds.find(x=>x.id===f.id)!;
    assert.ok(row.amount>=0&&row.amount<=row.capacity+1e-7);
    assert.equal(cents(row.amount)%cents(f.step),0);
    assert.equal(cents(row.execution.reduce((s,x)=>s+x.amount*x.days,0)),cents(row.amount));
    assert.ok(row.execution.reduce((s,x)=>s+x.days,0)<=p.days);
    for(const e of row.execution){assert.ok(e.amount+1e-7>=f.minimum);if(f.dailyLimit!==null)assert.ok(e.amount<=f.dailyLimit+1e-7);assert.equal(cents(e.amount)%cents(f.step),0);}
    if(f.paused)assert.equal(row.amount,0);
    if(f.monthlyLimit!==null)assert.ok(row.amount<=f.monthlyLimit+1e-7);
  }
  for(const c of plan.categories)assert.ok(c.buy<=Math.max(0,c.targetValue-c.current)+1e-7);
  return plan;
}
test('空组合、零预算与零资产压力测试',()=>{
  const p=emptyPortfolio();assert.equal(rebalance(p).remainder,4000);
  p.budget=0;assert.equal(rebalance(p).spent,0);
  assert.equal(stress(p).rate,0);assert.equal(stress(p).warning,false);
});
test('比例正确时新增资金按目标分配，保留分币余额',()=>{
  const p=emptyPortfolio();p.budget=4000.25;p.funds=p.categories.map(c=>fund({id:c.id,categoryId:c.id}));
  const r=invariant(p);assert.equal(r.spent,4000);assert.equal(r.remainder,.25);
  assert.deepEqual(r.categories.map(c=>c.buy),[1680,1800,520]);
});
test('最低申购额高于日限额时不可购买',()=>{
  const p=one({funds:[fund({minimum:100,dailyLimit:10})]});
  const r=invariant(p);assert.equal(r.spent,0);assert.equal(r.funds[0].capacity,0);
});
test('日限额按步长取整，月限额共同约束',()=>{
  const p=one({days:20,budget:1000,funds:[fund({dailyLimit:19.99,monthlyLimit:155.5,minimum:10,step:10})]});
  const r=invariant(p);assert.equal(r.spent,150);assert.deepEqual(r.funds[0].execution,[{amount:10,days:15}]);
});
test('每天最少等于最多时，月金额不能落入不可执行的空隙',()=>{
  const p=one({days:20,budget:250,funds:[fund({dailyLimit:100,minimum:100,step:10})]});
  const r=invariant(p);assert.equal(r.spent,200);assert.equal(r.remainder,50);assert.deepEqual(r.funds[0].execution,[{amount:100,days:2}]);
});
test('暂停申购仍参与市值、仓位与风险统计',()=>{
  const p=one({funds:[fund({value:1000,paused:true})]});
  const r=invariant(p);assert.equal(r.spent,0);assert.equal(r.investedAfter,1000);assert.equal(stress(p).loss,600);
});
test('超配类别不新增，缺少可申购基金时保留现金',()=>{
  const p=emptyPortfolio();p.funds=[fund({value:10000})];
  const r=invariant(p);assert.equal(r.spent,0);assert.equal(r.remainder,4000);
});
test('同类相同步长按权重分配，限额后转投同类其他基金',()=>{
  const p=one({budget:300,funds:[fund({id:'a',weight:2}),fund({id:'b',weight:1})]});
  assert.deepEqual(invariant(p).funds.map(f=>f.amount),[200,100]);
  p.funds[0].monthlyLimit=150;assert.deepEqual(invariant(p).funds.map(f=>f.amount),[150,150]);
});
test('示例包含限购未分配额，计算不改变输入',()=>{
  const p=demoPortfolio(),original=structuredClone(p),r=invariant(p);
  assert.equal(r.remainder,600);assert.deepEqual(p,original);
});
test('全资产压力包含存款和债券；外部预算只增加一次',()=>{
  const p=one({cash:100000,bonds:20000,funds:[fund({value:10000})]}),plan=rebalance(p),r=stress(p),after=stress(p,plan);
  assert.equal(r.total,130000);assert.equal(r.loss,8000);assert.equal(r.rate,8000/130000*100);
  assert.equal(after.total,134000);assert.equal(after.rows.reduce((s,x)=>s+x.value,0),134000);
  p.funds[0].paused=true;const paused=stress(p,rebalance(p));assert.equal(paused.rows.find(x=>x.name==='存款 / 现金')!.value,104000);assert.equal(paused.total,134000);
});
test('备份往返无损；损坏、未知版本、重复标识、负值均拒绝',()=>{
  const p=demoPortfolio();assert.deepEqual(parseBackup(JSON.stringify(envelope(p))).portfolio,p);
  assert.throws(()=>parseBackup('{'));
  const e=envelope(p);assert.throws(()=>parseBackup(JSON.stringify({...e,schemaVersion:2})));
  e.portfolio.cash=-1;assert.throws(()=>parseBackup(JSON.stringify(e)));
  e.portfolio.cash=1;e.portfolio.funds[1].id=e.portfolio.funds[0].id;assert.throws(()=>parseBackup(JSON.stringify(e)));
  assert.throws(()=>parseBackup(' '.repeat(1024*1024+1)));
});
test('比例不满100、负预算、不合法天数和精度均不能计算',()=>{
  const p=one();p.categories[0].target=99;assert.throws(()=>rebalance(p));
  p.categories[0].target=100;p.budget=-1;assert.throws(()=>rebalance(p));
  p.budget=1;p.days=1.2;assert.throws(()=>rebalance(p));
  p.days=20;p.cash=1.005;assert.ok(validate(p).length>0);
});
let seed=14723;
const rand=(n:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
test('400组不同约束组合，金额守恒、限额、最低额与执行日全部成立',()=>{
  for(let i=0;i<400;i++){
    const p=emptyPortfolio();p.budget=rand(1000)+.37;p.days=rand(31)+1;
    p.funds=Array.from({length:rand(8)+1},(_,j)=>fund({id:String(j),categoryId:p.categories[rand(3)].id,value:rand(3000),dailyLimit:rand(3)?rand(100):null,monthlyLimit:rand(3)?rand(700):null,minimum:rand(60),step:[1,5,10,20][rand(4)],weight:rand(5)+1,paused:!rand(8)}));invariant(p);
  }
});
test('单位步长且无最低额空隙时，与小规模穷举的平方缺口最小值一致',()=>{
  for(let k=0;k<50;k++){
    const p=one({budget:rand(8)+1,categories:[{id:'us',name:'一',target:50,shock:60},{id:'cn',name:'二',target:50,shock:60}],funds:[fund({id:'a',value:rand(4),monthlyLimit:rand(7)}),fund({id:'b',value:rand(4),monthlyLimit:rand(7)}),fund({id:'c',categoryId:'cn',value:rand(4),monthlyLimit:rand(7)})]});
    const total=p.funds.reduce((s,f)=>s+f.value,0),goal=(total+p.budget)/2,a0=p.funds[0].value+p.funds[1].value,c0=p.funds[2].value;
    let best=Infinity;
    for(let a=0;a<=p.funds[0].monthlyLimit!;a++)for(let b=0;b<=p.funds[1].monthlyLimit!;b++)for(let c=0;c<=p.funds[2].monthlyLimit!;c++)if(a+b+c<=p.budget&&a+b<=Math.max(0,goal-a0)&&c<=Math.max(0,goal-c0))best=Math.min(best,(goal-a0-a-b)**2+(goal-c0-c)**2);
    const r=invariant(p),a=r.categories[0].buy,c=r.categories[1].buy;assert.equal((goal-a0-a)**2+(goal-c0-c)**2,best);
  }
});
test('最大预算与最小步长可完成分配',()=>{const r=invariant(one({budget:1_000_000}));assert.equal(r.spent,1_000_000);});
test('新基金默认1元步长不会挤占同类已有10元步长基金的预算',()=>{
  const p=one({budget:300,funds:[fund({id:'old',step:10,minimum:10}),fund({id:'new',step:1,minimum:0})]});
  assert.deepEqual(invariant(p).funds.map(f=>f.amount),[150,150]);
});
