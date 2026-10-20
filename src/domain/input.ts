export function parseNumberInput(text:string,nullable=false):number|null{const clean=text.replace(/[,，¥￥%％\s]/g,'');if(!clean)return nullable?null:0;return /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(clean)?Number(clean):NaN;}
// Largest remainder rounding keeps percentages and monetary totals exact.
export function distributeUnits(weights:readonly number[],total:number):number[]{
  if(!Number.isSafeInteger(total)||total<0||weights.length===0||weights.some(w=>!Number.isFinite(w)||w<0))throw new Error('无效的比例或金额。');
  const sum=weights.reduce((s,w)=>s+w,0),effective=sum>0?weights:weights.map(()=>1),den=sum||weights.length;
  const slots=effective.map((w,i)=>{const exact=w/den*total;return {i,exact,n:Math.floor(exact)};});
  const left=total-slots.reduce((s,a)=>s+a.n,0),order=[...slots].sort((a,b)=>(b.exact-b.n)-(a.exact-a.n)||a.i-b.i);
  if(left>=0){for(let i=0;i<left;i++)order[i%order.length].n++;}else{const reversed=[...order].reverse();for(let i=0;i< -left;i++){const candidate=reversed.find(a=>a.n>0);if(candidate)candidate.n--;}}
  return slots.map(a=>a.n);
}
export function normaliseWeights(weights:readonly number[]):number[]{return distributeUnits(weights,10000).map(n=>n/100);}
export function changeWeight(weights:readonly number[],index:number,value:number):number[]{
  if(index<0||index>=weights.length||weights.length<2||!Number.isFinite(value))return [...weights];
  const target=Math.round(Math.max(0,Math.min(100,value))*100),others=weights.filter((_,i)=>i!==index),units=distributeUnits(others,10000-target);
  let j=0;return weights.map((_,i)=>(i===index?target:units[j++])/100);
}
