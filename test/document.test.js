'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
let api;
try { api = require('../src/document'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; api = {}; }
const source = '{\r\n  "pageId":"PG-X", "views":{"rows":[{"component":{"fields":[{"label":"旧名","width":1,"unknown":9007199254740993}],"params":{"pageEvents":{"onOpenScript":"旧脚本"},"serviceEvents":{"afterSaveScript":"保留"}}}}]}, "unknown": 1e+09\r\n}\r\n';
test('只替换字段值，保留换行、未知属性及大整数原文', () => {
  assert.equal(typeof api.createEdit, 'function');
  const edit = api.createEdit(source, ['views','rows',0,'component','fields',0,'label'], '新名');
  assert.equal(source.slice(0, edit.start) + edit.text + source.slice(edit.end), source.replace('旧名','新名'));
});
test('脚本保存后准确往返，包含引号和换行', () => {
  const value = 'const x = "中文";\n$vm.refresh();';
  const edit = api.createEdit(source, ['views','rows',0,'component','params','pageEvents','onOpenScript'], value);
  const changed = source.slice(0,edit.start) + edit.text + source.slice(edit.end);
  assert.equal(JSON.parse(changed).views.rows[0].component.params.pageEvents.onOpenScript,value);
});
test('保存字符串采用平台转义，保持控制字符、中文和字面转义文本',()=>{
  const cases=[
    ["='<> &",String.raw`"\u003d\u0027\u003c\u003e \u0026"`],
    ['"\\/\b\f\n\r\t\0',String.raw`"\"\\/\b\f\n\r\t\u0000"`],
    ['中文😀\u2028\u2029',String.raw`"中文😀\u2028\u2029"`],
    [String.raw`\u003d`,String.raw`"\\u003d"`],
    ['\ud800',String.raw`"\ud800"`]
  ];
  for(const [value,encoded] of cases){
    const edit=api.createEdit(source,['views','rows',0,'component','params','pageEvents','onOpenScript'],value);
    assert.equal(edit.text,encoded);assert.equal(JSON.parse(edit.text),value);
    const output=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
    assert.equal(output.slice(0,edit.start),source.slice(0,edit.start));
    assert.equal(output.slice(edit.start+edit.text.length),source.slice(edit.end));
  }
});
test('值未修改时，保留原有 Unicode 转义和数值字面量',()=>{
  const input=source.replace('旧名',String.raw`\u65e7\u540d`).replace('"width":1','"width":1e+0');
  for(const [key,value] of [['label','旧名'],['width',1]]){
    const edit=api.createEdit(input,['views','rows',0,'component','fields',0,key],value);
    assert.equal(input.slice(0,edit.start)+edit.text+input.slice(edit.end),input);
  }
});
test('服务事件支持精确编辑，页面身份仍不可修改', () => {
  const edit=api.createEdit(source,['views','rows',0,'component','params','serviceEvents','afterSaveScript'],'新脚本');
  assert.equal(source.slice(0,edit.start)+edit.text+source.slice(edit.end),source.replace('"afterSaveScript":"保留"','"afterSaveScript":"新脚本"'));
  assert.throws(() => api.createEdit(source,['pageId'],'x'), /不支持/);
});
test('错误 JSON、非页面文件和不存在的路径不能写入', () => {
  assert.throws(() => api.createEdit('{',[],1));
  assert.throws(() => api.createEdit('{"hello":1}', ['hello'],2));
  assert.throws(() => api.createEdit(source,['views','rows',99,'component','fields',0,'label'],'x'));
});
test('重复键必须拒绝，避免修改错误节点', () => {
  const text = source.replace('"label":"旧名"','"label":"旧名","label":"重名"');
  assert.throws(() => api.createEdit(text,['views','rows',0,'component','fields',0,'label'],'x'), /重复/);
});
test('已有简单属性支持字符串、数字、布尔值和 null 之间的类型转换',()=>{
  const path=['views','rows',0,'component','fields',0,'width'];
  for(const previous of [1,'1',true,null])for(const next of [2,'2',false,null]){
    const input=source.replace('"width":1','"width":'+JSON.stringify(previous)),edit=api.createEdit(input,path,next);
    assert.equal(JSON.parse(edit.text),next);
    assert.equal(input.slice(0,edit.start)+edit.text+input.slice(edit.end),input.replace('"width":'+JSON.stringify(previous),'"width":'+JSON.stringify(next)));
  }
});
test('简单属性仍不能替换为对象、数组或非有限数字', () => {
  for(const value of [{},[],NaN,Infinity,-Infinity,undefined])assert.throws(()=>api.createEdit(source,['views','rows',0,'component','fields',0,'width'],value));
  assert.throws(() => api.createEdit(source,['views','rows',0,'component','fields',0],{}));
});
test('原值为 null 的服务事件可以填写脚本，事件不能变为其他简单类型',()=>{
  const input=source.replace('"afterSaveScript":"保留"','"afterSaveScript":null'),path=['views','rows',0,'component','params','serviceEvents','afterSaveScript'];
  const edit=api.createEdit(input,path,'script');assert.equal(edit.text,'"script"');
  for(const value of [1,true,null])assert.throws(()=>api.createEdit(source,path,value),/脚本文本/);
});
test('顶层窗口保存按钮的前端及服务事件都可以精确编辑',()=>{
  const text='{"pageId":"PG-X","views":{"rows":[]},"modalSaveBnt":{"pageEvents":{"onClickScript":"old"},"serviceEvents":{"beforeSaveScript":"keep"}}}';
  const edit=api.createEdit(text,['modalSaveBnt','pageEvents','onClickScript'],'new');
  assert.equal(text.slice(0,edit.start)+edit.text+text.slice(edit.end),text.replace('old','new'));
  const serviceEdit=api.createEdit(text,['modalSaveBnt','serviceEvents','beforeSaveScript'],'x');
  assert.equal(text.slice(0,serviceEdit.start)+serviceEdit.text+text.slice(serviceEdit.end),text.replace('"keep"','"x"'));
});
