import {useState} from 'react';
import {validateFund,type Portfolio,type Fund} from './domain/model';
import {Icon,Modal,NumberField} from './components';
export default function FundEditor({fund,p,editing,onClose,onSave}:{fund:Fund;p:Portfolio;editing:boolean;onClose:()=>void;onSave:(f:Fund,another:boolean)=>void}) {
  const [draft,setDraft]=useState(fund),[error,setError]=useState<string[]>([]);
  const customised=draft.dailyLimit!==null||draft.monthlyLimit!==null||draft.minimum>0||draft.step!==1||draft.weight!==1||draft.paused;
  const u=(patch:Partial<Fund>)=>{setDraft(v=>({...v,...patch}));setError([]);};
  const save=(another=false)=>{const value={...draft,name:draft.name.trim()},issues=validateFund(value,p.categories);if(issues.length){setError(issues);return;}onSave(value,another);};
  return <Modal title={editing?'编辑基金':'添加基金'} onClose={onClose}>
    <form onSubmit={e=>{e.preventDefault();save();}}>
      <p className="form-intro">只需填写名称或代码，市值可以稍后补。类别会记住上次的选择。</p>
      <label className="field"><span>基金名称或代码 <small className="required-mark">必填</small></span><input autoFocus required maxLength={80} value={draft.name} placeholder="简称、全称、代码，填一个就好" onChange={e=>u({name:e.target.value})}/></label>
      <fieldset className="category-choice"><legend>所属类别</legend><div>{p.categories.map(c=><label key={c.id} className={draft.categoryId===c.id?'selected':''}><input type="radio" name="category" value={c.id} checked={draft.categoryId===c.id} onChange={()=>u({categoryId:c.id})}/><span>{c.name}</span></label>)}</div></fieldset>
      <NumberField label="当前市值（选填）" value={draft.value} emptyZero placeholder="可留空，稍后在列表补填" help="还没买入可留空；金额支持直接粘贴，例如 1,234.56。" onChange={v=>u({value:v??0})}/>
      <details className="advanced-settings"><summary><span><Icon name="assets" size={16}/>限购与其他设置 <small>选填</small></span><span className="advanced-state">{customised?'已自定义':'使用默认值'}</span></summary><div className="advanced-body">
        <p className="field-note">没有特殊限制可以全部留空。默认不限额、按 1 元一档分配，同类基金均等分配新增资金。</p>
        <div className="form-grid two"><NumberField label="每天最多买入" value={draft.dailyLimit} nullable onChange={v=>u({dailyLimit:v})}/><NumberField label="本月剩余可买额度" value={draft.monthlyLimit} nullable onChange={v=>u({monthlyLimit:v})}/></div>
        <details className="extra-settings"><summary>最低申购额、金额步长和分配偏好</summary><div className="form-grid two"><NumberField label="每次最低申购额" value={draft.minimum||null} nullable placeholder="不限制" onChange={v=>u({minimum:v??0})}/><NumberField label="购买金额步长" value={draft.step===1?null:draft.step} nullable placeholder="默认 1" step="1" min={1} onChange={v=>u({step:v??1})}/><NumberField label="同类内分配权重" value={draft.weight===1?null:draft.weight} nullable placeholder="默认均等" step="1" min={1} max={100} suffix="份" help="通常不用改；例如 2:1 表示倾向分配两倍新增金额。" onChange={v=>u({weight:v??1})}/><label className="checkbox-field"><input type="checkbox" checked={draft.paused} onChange={e=>u({paused:e.target.checked})}/><span>暂停新增买入<small>保留持仓，暂不分配新预算</small></span></label></div></details>
      </div></details>
      {error.length>0&&<ul className="form-errors" role="alert">{error.map(x=><li key={x}>{x}</li>)}</ul>}
      <div className="modal-actions"><button type="button" className="btn cancel-button" onClick={onClose}>取消</button>{!editing&&p.funds.length<39&&<button type="button" className="btn" onClick={()=>save(true)}>保存并继续添加</button>}<button type="submit" className="btn primary">{editing?'保存修改':'添加基金'}</button></div>
    </form>
  </Modal>;
}
