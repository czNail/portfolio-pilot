import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createFund,emptyPortfolio,demoPortfolio,validate,validateFund} from '../src/domain/model';
import {normaliseTargets,parseNumberInput} from '../src/domain/input';
import {envelope,parseBackup} from '../src/storage/backup';
import {rebalance,stress} from '../src/domain/rebalance';
import FundEditor from '../src/FundEditor';
test('新基金只填名称就能保存；金额和全部高级设置采用默认值',()=>{
  const p=emptyPortfolio(),f=createFund(p.categories[0].id);f.name='我的基金';
  assert.deepEqual(validateFund(f,p.categories),[]);
  assert.equal(f.value,0);assert.equal(f.minimum,0);assert.equal(f.step,1);assert.equal(f.weight,1);assert.equal(f.dailyLimit,null);assert.equal(f.monthlyLimit,null);
  assert.ok(validateFund({...f,name:''},p.categories).length>0);
});
test('目标尚未填满100%不阻碍保存基金、备份与压力测试，买入计划仍严格校验',()=>{
  const p=demoPortfolio();p.categories[0].target=10;
  assert.deepEqual(validate(p,{requireTargets:false}),[]);
  assert.ok(validate(p).length>0);
  assert.deepEqual(validateFund(p.funds[0],p.categories),[]);
  assert.deepEqual(parseBackup(JSON.stringify(envelope(p))).portfolio,p);
  assert.ok(stress(p).total>0);assert.throws(()=>rebalance(p));
});
test('旧备份中已经设置的限购、最低额、步长和权重无损保留',()=>{
  const p=demoPortfolio();assert.deepEqual(parseBackup(JSON.stringify(envelope(p))).portfolio,p);
  assert.equal(p.funds[0].minimum,10);assert.equal(p.funds[0].step,10);assert.equal(p.funds[0].weight,2);
});
test('金额支持从页面粘贴分隔符、人民币符号；非法文本不会被误当成0',()=>{
  assert.equal(parseNumberInput('￥ 12,345.67'),12345.67);
  assert.equal(parseNumberInput('¥1，234.56'),1234.56);
  assert.equal(parseNumberInput('  '),0);assert.equal(parseNumberInput('',true),null);
  assert.equal(parseNumberInput('42%'),42);assert.equal(parseNumberInput('.5'),.5);
  assert.ok(Number.isNaN(parseNumberInput('5abc')));assert.ok(Number.isNaN(parseNumberInput('1.2.3')));
  assert.equal(parseNumberInput('-1'),-1); // 保留供金额规则显式拒绝，不静默改值。
});
test('按现有比例归一时精确合计100%，保留零权重，不修改原对象',()=>{
  const p=emptyPortfolio();p.categories.forEach(c=>c.target=33.33);const old=structuredClone(p.categories);
  const next=normaliseTargets(p.categories);assert.equal(next.reduce((s,c)=>s+Math.round(c.target*100),0),10000);assert.deepEqual(p.categories,old);
  p.categories[0].target=0;assert.equal(normaliseTargets(p.categories)[0].target,0);
  p.categories.forEach(c=>c.target=0);assert.throws(()=>normaliseTargets(p.categories));
});
test('添加表单仅名称必填，高级设置默认折叠，并提供连续添加',()=>{
  const p=emptyPortfolio(),f=createFund('us');const html=renderToStaticMarkup(<FundEditor fund={f} p={p} editing={false} onClose={()=>{}} onSave={()=>{}}/>);
  assert.equal((html.match(/\srequired=/g)||[]).length,1);
  assert.match(html,/保存并继续添加/);assert.match(html,/限购与其他设置/);
  assert.doesNotMatch(html,/<details[^>]*\sopen(?:[\s=>])/);
  assert.doesNotMatch(html,/type="number"/);
});
