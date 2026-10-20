import {validate,type Portfolio} from '../domain/model';
import {parseLegacyBackup} from '../legacy/backup';
import {migrateLegacy} from '../domain/migrate';
export const STORAGE_KEY='portfolio-pilot:portfolio:v2';
export const LEGACY_KEY='portfolio-pilot:portfolio:v1';
export const MAX_BACKUP_BYTES=1024*1024;
export interface Envelope {app:'portfolio-pilot';schemaVersion:2;savedAt:string;portfolio:Portfolio;migrated?:boolean;}
export function envelope(p:Portfolio):Envelope{return {app:'portfolio-pilot',schemaVersion:2,savedAt:new Date().toISOString(),portfolio:p};}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const number=(v:unknown):number=>{if(typeof v!=='number')throw new Error('金额或比例字段格式不正确。');return v;};
const string=(v:unknown):string=>{if(typeof v!=='string'||!v||v.length>200)throw new Error('资产类别文本格式不正确。');return v;};
export function parseBackup(text:string):Envelope{
  if(new TextEncoder().encode(text).length>MAX_BACKUP_BYTES)throw new Error('文件不能超过 1 MiB。');
  let raw:unknown;try{raw=JSON.parse(text);}catch{throw new Error('文件不是有效的 JSON。');}
  if(!object(raw)||raw.app!=='portfolio-pilot')throw new Error('不是仓位助手的备份。');
  if(raw.schemaVersion===1){const e=parseLegacyBackup(text);return {...envelope(migrateLegacy(e.portfolio)),savedAt:e.savedAt,migrated:true};}
  if(raw.schemaVersion!==2||!object(raw.portfolio)||typeof raw.savedAt!=='string'||!Number.isFinite(Date.parse(raw.savedAt)))throw new Error('不支持的备份版本或格式。');
  const x=raw.portfolio;
  if(x.version!==2||typeof x.demo!=='boolean'||!Array.isArray(x.assets)||x.assets.length>16||!['external','cash','reserve'].includes(String(x.source)))throw new Error('资产配置格式不正确。');
  const portfolio:Portfolio={version:2,demo:x.demo,budget:number(x.budget),source:x.source as Portfolio['source'],rounding:number(x.rounding) as Portfolio['rounding'],reserve:number(x.reserve),reserveShock:number(x.reserveShock),threshold:number(x.threshold),assets:x.assets.map(a=>{if(!object(a))throw new Error('资产类别格式不正确。');return {id:string(a.id),name:string(a.name),value:number(a.value),target:number(a.target),shock:number(a.shock),monthlyLimit:a.monthlyLimit===null?null:number(a.monthlyLimit)};})};
  const issues=validate(portfolio);if(issues.length)throw new Error(issues.join('\n'));
  return {app:'portfolio-pilot',schemaVersion:2,savedAt:raw.savedAt,portfolio};
}
export function downloadText(text:string,filename:string,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
