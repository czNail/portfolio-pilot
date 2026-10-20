import type {CSSProperties} from 'react';
import {NumberField,colors,pct,money} from './components';
import {CASH_ID,type Portfolio} from './domain/model';
import type {Plan} from './domain/rebalance';
export function ShareSlider({name,value,onChange,color=colors[0],label='目标占比'}:{name:string;value:number;onChange:(v:number)=>void;color?:string;label?:string}){
  return <div className="share-control"><input aria-label={`${name}${label}滑条`} type="range" min="0" max="100" step="0.1" value={Number.isFinite(value)?value:0} onChange={e=>onChange(Number(e.target.value))} style={{'--range-color':color,'--fill':`${value}%`} as CSSProperties}/><div className="share-number"><NumberField hideLabel label={`${name}${label}`} suffix="%" value={value} onChange={v=>onChange(v??0)}/></div></div>;
}
export function MixBar({p,plan}:{p:Portfolio;plan?:Plan}){
  const rows=p.assets.map((a,i)=>({id:a.id,name:a.name,color:colors[i%colors.length],value:plan?.rows.find(r=>r.id===a.id)?.after??a.value}));
  const total=rows.reduce((s,a)=>s+a.value,0);
  return <div className="mix-chart"><div className="mix-bar" role="img" aria-label={total?rows.map(a=>`${a.name} ${pct(a.value/total*100)}`).join('；'):'尚未录入持仓'}>{total>0?rows.filter(a=>a.value>0).map(a=><span key={a.id} style={{width:`${a.value/total*100}%`,background:a.color}} title={`${a.name} ${pct(a.value/total*100)}`}/>):<span className="empty-mix"/>}</div><div className="mix-legend">{rows.filter(a=>a.value>0).map(a=><span key={a.id}><i style={{background:a.color}}/>{a.name}<strong>{pct(a.value/total*100)}</strong></span>)}</div></div>;
}
export function PlanTable({p,plan}:{p:Portfolio;plan:Plan}){
  const relevant=p.assets.filter(a=>a.value>0||a.target>0||(plan.rows.find(r=>r.id===a.id)?.after||0)>0);
  const note=(a:Portfolio['assets'][number],buy:number)=>a.id===CASH_ID?'安排后的现金余额':a.monthlyLimit===0?'本月上限设为 0':a.target===0?'目标为 0%':buy===0?'本次先补其他类别':'';
  return <><div className="table-scroll desktop-plan"><table className="plan-table"><thead><tr><th>资产类别</th><th className="numeric">本次安排</th><th className="numeric">当前占比</th><th className="numeric">安排后占比</th><th className="numeric">目标</th></tr></thead><tbody>{relevant.map(a=>{const i=p.assets.findIndex(x=>x.id===a.id),r=plan.rows.find(x=>x.id===a.id)!;return <tr key={a.id}><td><span className="asset-name"><i style={{background:colors[i%colors.length]}}/>{a.name}</span></td><td className="numeric"><strong className={a.id!==CASH_ID&&r.buy>0?'accent':''}>{a.id===CASH_ID?money(r.after):r.buy>0?`+ ${money(r.buy)}`:'暂不追加'}</strong><small>{note(a,r.buy)}</small></td><td className="numeric">{pct(r.beforeWeight)}</td><td className="numeric after-weight">{pct(r.afterWeight)}</td><td className="numeric muted-cell">{pct(a.target)}</td></tr>;})}</tbody></table></div>
  <div className="mobile-plan">{relevant.map(a=>{const i=p.assets.findIndex(x=>x.id===a.id),r=plan.rows.find(x=>x.id===a.id)!;return <div className="mobile-plan-row" key={a.id}><div><span className="asset-name"><i style={{background:colors[i%colors.length]}}/>{a.name}</span><strong className={a.id!==CASH_ID&&r.buy>0?'accent':''}>{a.id===CASH_ID?money(r.after):r.buy>0?`+ ${money(r.buy)}`:'暂不追加'}</strong></div><div className="mobile-plan-meta"><span>当前 {pct(r.beforeWeight)} → <b>{pct(r.afterWeight)}</b></span><span>目标 {pct(a.target)}</span></div>{note(a,r.buy)&&<small>{note(a,r.buy)}</small>}</div>;})}</div></>;
}
