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
test('不允许原版界面改写布局、数据源或字段身份',()=>{
 const b=fixture();for(const mutate of [n=>n.views.rows.push({}),n=>n.views.rows[0].component.datasource.sql='改',n=>n.views.rows[0].component.fields[0].id='f2']){const n=clone(b);mutate(n);assert.throws(()=>api.createNativeEdits(text,b,n),/不支持/);}
});
test('保存按钮服务事件只替换目标字符串，保留平台转义及其他原文',()=>{
 const source=text.replace('"params":{}','"buttons":[{"id":"save","serviceEvents":{"beforeSaveScript":"old","afterSaveScript":"keep"}}],"params":{}');
 const b=JSON.parse(source),n=clone(b);n.views.rows[0].component.buttons[0].serviceEvents.beforeSaveScript="#set($x = '中文');\r\n";
 const output=apply(source,api.createNativeEdits(source,b,n));
 assert.equal(output,source.replace('"old"',String.raw`"#set($x \u003d \u0027中文\u0027);\r\n"`));
 assert.deepEqual(api.createNativeEdits(source,b,clone(b)),[]);
});
test('服务事件支持在已有对象下新增和清空脚本',()=>{
 const b=fixture(),n=clone(b);n.views.rows[0].component.params.serviceEvents={beforeSaveScript:'new'};n.pageSetup.serviceEvents={onInitScript:'page'};
 const added=apply(text,api.createNativeEdits(text,b,n)),loaded=JSON.parse(added);
 assert.equal(loaded.views.rows[0].component.params.serviceEvents.beforeSaveScript,'new');assert.equal(loaded.pageSetup.serviceEvents.onInitScript,'page');
 const cleared=clone(loaded);delete cleared.views.rows[0].component.params.serviceEvents.beforeSaveScript;
 assert.equal(apply(added,api.createNativeEdits(added,loaded,cleared)),added.replace('"beforeSaveScript":"new"','"beforeSaveScript":""'));
 const modal='{"pageId":"PG-X","views":{"rows":[]},"modalSaveBnt":{"serviceEvents":{"beforeSaveScript":"old"}}}';
 const mb=JSON.parse(modal),mn=clone(mb);mn.modalSaveBnt.serviceEvents.beforeSaveScript='changed';mn.modalSaveBnt.serviceEvents.afterSaveScript='added';
 const result=JSON.parse(apply(modal,api.createNativeEdits(modal,mb,mn)));assert.equal(result.modalSaveBnt.serviceEvents.beforeSaveScript,'changed');assert.equal(result.modalSaveBnt.serviceEvents.afterSaveScript,'added');
});
test('服务事件仅允许脚本字符串，不接受对象、数组及其他值类型',()=>{
 const b=fixture();
 for(const value of [1,true,null,{nested:'x'},['x']]){
  const n=clone(b);n.pageSetup.serviceEvents={beforeSaveScript:value};assert.throws(()=>api.createNativeEdits(text,b,n),/不支持/);
 }
});
test('字段对话框关闭时清理的临时属性不会删除原文件内容',()=>{
 const b=fixture();b.views.rows[0].component.fields[0].superPageEvents={};b.views.rows[0].component.fields[0].selectBox={};
 const n=clone(b);delete n.views.rows[0].component.fields[0].superPageEvents;delete n.views.rows[0].component.fields[0].selectBox;n.views.rows[0].component.fields[0].label='新';
 assert.equal(apply(text,api.createNativeEdits(text,b,n)),text.replace('旧','新'));
});
test('原版设计器替换已有值时保留平台转义及目标外原文',()=>{
 const source=text.replace('"label":"旧"',String.raw`"label":"\u003d\u0027\u003c\u003e\u0026"`);
 const b=JSON.parse(source),n=clone(b);n.views.rows[0].component.fields[0].label="='<> &新";
 assert.equal(apply(source,api.createNativeEdits(source,b,n)),source.replace(String.raw`"\u003d\u0027\u003c\u003e\u0026"`,String.raw`"\u003d\u0027\u003c\u003e \u0026新"`));
 assert.deepEqual(api.createNativeEdits(source,b,clone(b)),[]);
});
test('新增属性和事件共用平台转义，不重复转义脚本文本',()=>{
 const b=fixture(),n=clone(b),value="='<> &\r\n\t中文😀\u2028\u2029"+String.raw`\u003d`;
 const encoded=String.raw`"\u003d\u0027\u003c\u003e \u0026\r\n\t中文😀\u2028\u2029\\u003d"`;
 n.views.rows[0].component.fields[0].format=value;n.pageSetup.pageEvents={onOpenScript:value};
 const output=apply(text,api.createNativeEdits(text,b,n));
 assert.equal(output,text.replace('"width":1','"width":1,"format":'+encoded).replace('"pageSetup":{}','"pageSetup":{"pageEvents":{"onOpenScript":'+encoded+'}}'));
 const parsed=JSON.parse(output);assert.equal(parsed.views.rows[0].component.fields[0].format,value);assert.equal(parsed.pageSetup.pageEvents.onOpenScript,value);
});
test('原版设计器的简单属性类型变化及 null 服务事件可以精确保存',()=>{
 const source=text.replace('"params":{}','"params":{"serviceEvents":{"beforeSaveScript":null}}'),b=JSON.parse(source),n=clone(b);
 n.views.rows[0].component.fields[0].width='120';n.views.rows[0].component.params.serviceEvents.beforeSaveScript='script';
 assert.equal(apply(source,api.createNativeEdits(source,b,n)),source.replace('"width":1','"width":"120"').replace('"beforeSaveScript":null','"beforeSaveScript":"script"'));
});
test('新增属性不能保存非有限数字，结构类型错误包含路径',()=>{
 const b=fixture();
 for(const value of [NaN,Infinity,-Infinity]){const n=clone(b);n.views.rows[0].component.fields[0].newWidth=value;assert.throws(()=>api.createNativeEdits(text,b,n),/不支持/);}
 const n=clone(b);n.views.rows[0].component.fields[0].width={nested:1};
 assert.throws(()=>api.createNativeEdits(text,b,n),/\/views\/rows\/0\/component\/fields\/0\/width/);
});
