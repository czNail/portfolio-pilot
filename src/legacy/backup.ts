import { validate, type Portfolio } from './model';
export const STORAGE_KEY='portfolio-pilot:portfolio:v1';
export const MAX_BACKUP_BYTES=1024*1024;
export interface Envelope { app: 'portfolio-pilot'; schemaVersion: 1; savedAt: string; portfolio: Portfolio; }
export function envelope(p: Portfolio): Envelope {return {app:'portfolio-pilot',schemaVersion:1,savedAt:new Date().toISOString(),portfolio:p};}
const object=(x: unknown): x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
function requireNumber(o: Record<string,unknown>,k:string): number {if(typeof o[k]!=='number')throw new Error(`字段 ${k} 必须是数值。`);return o[k];}
function requireString(o: Record<string,unknown>,k:string): string {if(typeof o[k]!=='string'||o[k].length>160||!o[k])throw new Error(`字段 ${k} 必须是有效文本。`);return o[k];}
export function parseLegacyBackup(text: string): Envelope {
  if(new TextEncoder().encode(text).length>MAX_BACKUP_BYTES)throw new Error('备份文件不能超过 1 MiB。');
  let raw:unknown;try{raw=JSON.parse(text);}catch{throw new Error('文件不是有效的 JSON。');}
  if(!object(raw)||raw.app!=='portfolio-pilot'||raw.schemaVersion!==1||!object(raw.portfolio)||typeof raw.savedAt!=='string'||!Number.isFinite(Date.parse(raw.savedAt)))throw new Error('不是受支持的 Portfolio Pilot v1 备份。');
  const x=raw.portfolio;
  if(x.version!==1||typeof x.demo!=='boolean'||!Array.isArray(x.categories)||!Array.isArray(x.funds)||x.categories.length>8||x.funds.length>40)throw new Error('备份的数据结构或记录数量不正确。');
  const categories=x.categories.map(c=>{if(!object(c))throw new Error('类别格式不正确。');return {id:requireString(c,'id'),name:requireString(c,'name'),target:requireNumber(c,'target'),shock:requireNumber(c,'shock')};});
  const funds=x.funds.map(f=>{
    if(!object(f)||typeof f.paused!=='boolean')throw new Error('基金格式不正确。');
    return {id:requireString(f,'id'),name:requireString(f,'name'),categoryId:requireString(f,'categoryId'),value:requireNumber(f,'value'),minimum:requireNumber(f,'minimum'),step:requireNumber(f,'step'),weight:requireNumber(f,'weight'),paused:f.paused,
      dailyLimit:f.dailyLimit===null?null:requireNumber(f,'dailyLimit'),monthlyLimit:f.monthlyLimit===null?null:requireNumber(f,'monthlyLimit')};
  });
  const portfolio:Portfolio={version:1,demo:x.demo as boolean,cash:requireNumber(x,'cash'),bonds:requireNumber(x,'bonds'),budget:requireNumber(x,'budget'),days:requireNumber(x,'days'),threshold:requireNumber(x,'threshold'),cashShock:requireNumber(x,'cashShock'),bondShock:requireNumber(x,'bondShock'),categories,funds};
  const issues=validate(portfolio,{requireTargets:false});if(issues.length)throw new Error(issues.join('\n'));
  return {app:'portfolio-pilot',schemaVersion:1,savedAt:raw.savedAt,portfolio};
}
export function downloadText(text:string,filename:string,type='application/json') {
  const url=URL.createObjectURL(new Blob([text],{type}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
