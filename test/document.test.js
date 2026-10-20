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
test('禁止编辑服务端事件以及页面身份', () => {
  assert.throws(() => api.createEdit(source,['views','rows',0,'component','params','serviceEvents','afterSaveScript'],'x'), /不支持/);
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
test('不能将已有属性替换为对象或改变值类型', () => {
  assert.throws(() => api.createEdit(source,['views','rows',0,'component','fields',0,'width'],'2'), /类型/);
  assert.throws(() => api.createEdit(source,['views','rows',0,'component','fields',0],{}));
});
test('顶层窗口保存按钮的前端事件可以精确编辑，服务端事件保持受限',()=>{
  const text='{"pageId":"PG-X","views":{"rows":[]},"modalSaveBnt":{"pageEvents":{"onClickScript":"old"},"serviceEvents":{"beforeSaveScript":"keep"}}}';
  const edit=api.createEdit(text,['modalSaveBnt','pageEvents','onClickScript'],'new');
  assert.equal(text.slice(0,edit.start)+edit.text+text.slice(edit.end),text.replace('old','new'));
  assert.throws(()=>api.createEdit(text,['modalSaveBnt','serviceEvents','beforeSaveScript'],'x'),/不支持/);
});
