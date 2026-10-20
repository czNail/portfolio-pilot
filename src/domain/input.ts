import type { Category } from './model';
export function parseNumberInput(text: string, nullable = false): number | null {
  const clean=text.replace(/[,，¥￥%％\s]/g,'');
  if(!clean)return nullable?null:0;
  return /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(clean)?Number(clean):NaN;
}
export function normaliseTargets(categories: readonly Category[]): Category[] {
  const total=categories.reduce((sum,c)=>sum+c.target,0);
  if(!Number.isFinite(total)||total<=0||categories.some(c=>!Number.isFinite(c.target)||c.target<0))throw new Error('请先填写至少一个大于 0 的目标比例。');
  const amounts=categories.map((c,index)=>({index,exact:c.target/total*10000,units:Math.floor(c.target/total*10000)}));
  const remainder=10000-amounts.reduce((s,a)=>s+a.units,0);
  const ordered=[...amounts].sort((a,b)=>(b.exact-b.units)-(a.exact-a.units)||a.index-b.index);
  for(let i=0;i<remainder;i++)ordered[i%ordered.length].units++;
  return categories.map((c,i)=>({...c,target:amounts[i].units/100}));
}
