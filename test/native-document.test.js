'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
let api;try{api=require('../src/native-document');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;api={};}
const text='{"pageId":"PG-X","pageAliasId":"alias","views":{"rows":[{"component":{"id":"c1","fields":[{"id":"f1","label":"旧","width":1}],"params":{},"datasource":{"sql":"保留"}}}]},"pageSetup":{},"unknown":9007199254740993}';
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){const baseline=JSON.parse(text);delete baseline.pageAliasId;delete baseline.unknown;baseline.pageSetup.isHideCloseButton=0;return baseline;}
function apply(source,edits){return edits.sort((a,b)=>b.start-a.start).reduce((s,e)=>s.slice(0,e.start)+e.text+s.slice(e.end),source);}
test('设计器默认值与丢失的未知属性不会覆盖原文',()=>{
 assert.equal(typeof api.createNativeEdits,'function');const b=fixture();assert.deepEqual(api.createNativeEdits(text,b,clone(b)),[]);
});
test('按设计器基线识别用户修改，保留别名、后端内容和大整数',()=>{
 const b=fixture(),n=clone(b);n.views.rows[0].component.fields[0].label='新';
 assert.equal(apply(text,api.createNativeEdits(text,b,n)),text.replace('旧','新'));
});
test('允许为已有字段增加属性与增加前端事件，组合插入不互相覆盖',()=>{
 const b=fixture(),n=clone(b);n.views.rows[0].component.fields[0].isMust=1;n.views.rows[0].component.fields[0].format='0.00';n.pageSetup.pageEvents={onOpenScript:'console.log("hi")'};
 const result=JSON.parse(apply(text,api.createNativeEdits(text,b,n)));
 assert.equal(result.views.rows[0].component.fields[0].isMust,1);assert.equal(result.views.rows[0].component.fields[0].format,'0.00');assert.equal(result.pageSetup.pageEvents.onOpenScript,'console.log("hi")');
});
test('不允许原版界面改写布局、服务端事件或字段身份',()=>{
 const b=fixture();for(const mutate of [n=>n.views.rows.push({}),n=>n.views.rows[0].component.datasource.sql='改',n=>n.views.rows[0].component.fields[0].id='f2']){const n=clone(b);mutate(n);assert.throws(()=>api.createNativeEdits(text,b,n),/不支持/);}
});
test('字段对话框关闭时清理的临时属性不会删除原文件内容',()=>{
 const b=fixture();b.views.rows[0].component.fields[0].superPageEvents={};b.views.rows[0].component.fields[0].selectBox={};
 const n=clone(b);delete n.views.rows[0].component.fields[0].superPageEvents;delete n.views.rows[0].component.fields[0].selectBox;n.views.rows[0].component.fields[0].label='新';
 assert.equal(apply(text,api.createNativeEdits(text,b,n)),text.replace('旧','新'));
});
