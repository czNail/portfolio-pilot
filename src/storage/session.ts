import {emptyPortfolio,type Portfolio} from '../domain/model';
import {STORAGE_KEY,LEGACY_KEY,parseBackup} from './backup';
export interface Boot {p:Portfolio;blocked:boolean;raw:string;notice:string;savedAt:string;migrated:boolean;}
export function loadPortfolio(storage:Pick<Storage,'getItem'>):Boot{
  const empty={p:emptyPortfolio(),blocked:false,raw:'',notice:'',savedAt:'',migrated:false};
  try{
    const current=storage.getItem(STORAGE_KEY),legacy=current===null?storage.getItem(LEGACY_KEY):null,raw=current??legacy;
    if(raw===null)return empty;
    try{const e=parseBackup(raw);return {...empty,p:e.portfolio,savedAt:e.savedAt,migrated:!!e.migrated,notice:e.migrated?'旧持仓已按资产大类汇总；原存款保留为备用金。债券纳入组合后，目标按原债券占比衔接，请核对。':''};}
    catch{return {...empty,blocked:true,raw,notice:'本地数据暂时无法读取，已保留原内容并暂停保存。可以导出原始数据后恢复备份。'};}
  }catch{return {...empty,notice:'当前浏览器无法保存数据，请及时导出备份。'};}
}
