import type {Portfolio as LegacyPortfolio} from '../legacy/model';
import {emptyPortfolio,CASH_ID,cents,yuan,type Portfolio} from './model';
import {normaliseWeights} from './input';
export function migrateLegacy(old:LegacyPortfolio):Portfolio{
  const p=emptyPortfolio();p.demo=old.demo;p.budget=old.budget;p.reserve=old.cash;p.reserveShock=old.cashShock;p.threshold=old.threshold;
  const accum=new Map<string,{value:number;target:number;loss:number;fallbackShock:number}>();
  const canonical=(id:string,name:string)=>{const s=name.replace(/\s/g,'').toLowerCase();if(id==='us'||['美股','美国股票'].includes(s))return 'us';if(id==='cn'||['a股','中国股票'].includes(s))return 'cn';if(id==='gold'||s==='黄金')return 'gold';if(['债券','债券基金','bond','bonds'].includes(s))return 'bonds';return `legacy-${id}`;};
  const fundTotal=old.funds.reduce((s,f)=>s+cents(f.value),0),bondValue=cents(old.bonds),invested=fundTotal+bondValue,oldTarget=old.categories.reduce((s,c)=>s+c.target,0);
  for(const c of old.categories){
    const id=canonical(c.id,c.name);if(!p.assets.some(a=>a.id===id))p.assets.push({id,name:c.name,value:0,target:0,shock:c.shock,monthlyLimit:null});
    const value=old.funds.filter(f=>f.categoryId===c.id).reduce((s,f)=>s+cents(f.value),0),a=accum.get(id)||{value:0,target:0,loss:0,fallbackShock:c.shock};
    a.value+=value;a.loss+=value*c.shock/100;
    a.target+=oldTarget>0?c.target/oldTarget*(invested>0?fundTotal/invested:1)*100:0;
    accum.set(id,a);
  }
  const b=accum.get('bonds')||{value:0,target:0,loss:0,fallbackShock:old.bondShock};b.value+=bondValue;b.loss+=bondValue*old.bondShock/100;b.target+=invested>0?bondValue/invested*100:0;accum.set('bonds',b);
  p.assets=p.assets.map(a=>{const x=accum.get(a.id);return x?{...a,value:yuan(x.value),target:x.target,shock:Math.max(0,Math.min(100,x.value?x.loss/x.value*100:x.fallbackShock))}:{...a,target:0};});
  let weights=p.assets.map(a=>a.target);
  if(oldTarget===0||weights.reduce((s,w)=>s+w,0)===0)weights=invested?p.assets.map(a=>a.value):p.assets.map(a=>emptyPortfolio().assets.find(x=>x.id===a.id)?.target||0);
  const normalised=normaliseWeights(weights);p.assets=p.assets.map((a,i)=>({...a,target:normalised[i]}));
  const cash=p.assets.find(a=>a.id===CASH_ID)!;cash.monthlyLimit=null;
  return p;
}
