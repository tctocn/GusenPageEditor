'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function harness(mode="basic") {
  let provider, receive, changeHandler, saveHandler, apply;
  const messages = [], edits = [];
  const disposable = () => ({ dispose() {} });
  const doc = { version:1, isDirty:false, isClosed:false, uri:{ toString:()=> 'file://page' },
    save:async()=>true, getText:()=> '{"pageId":"PG-X","views":{"rows":[{"component":{"fields":[{"label":"旧"}]}}]}}', positionAt: offset => offset };
  const vscode = {
    Uri: { file: fsPath => ({ fsPath, toString:()=>fsPath }) }, Range: class { constructor(start,end) {this.start=start;this.end=end;} },
    WorkspaceEdit: class { replace(uri,range,text) {this.range=range;this.text=text;} },
    window: { registerCustomEditorProvider(type, value) { provider=value; return disposable(); } },
    workspace: { isTrusted:true, getConfiguration:()=>({get:key=>key==='editorMode'?mode:''}),
      async applyEdit(edit) { edits.push(edit); return apply ? apply(edit) : true; },
      onDidChangeTextDocument(handler) { changeHandler=handler; return disposable(); },
      onDidSaveTextDocument(handler) { saveHandler=handler; return disposable(); }
    }
  };
  const panel = { webview: { cspSource:'vscode-resource:', postMessage: async message => {messages.push(message);return true;},
    asWebviewUri: uri=>({toString:()=> 'vscode-resource://' + uri.fsPath}), onDidReceiveMessage(handler) {receive=handler;return disposable();} },onDidDispose:()=>disposable() };
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/extension.js'),'utf8'), {
    module, exports:module.exports, require:function load(name){
      if(name==='vscode')return vscode;
      if(name==='./native-provider') {const child={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/native-provider.js'),'utf8'),{module:child,exports:child.exports,require:load});return child.exports;}
      return require(name.startsWith('.')?path.join(__dirname,'../src',name):name);
    }
  });
  module.exports.activate({extensionPath:path.join(__dirname,'..'), subscriptions:[]});
  return { doc,panel,messages,edits, async open() {await provider.resolveCustomTextEditor(doc,panel);},
    send: message=>receive({protocolVersion:1, ...message}), setApply: fn=>{apply=fn;},
    changed:()=>changeHandler({document:doc}), saved:()=>saveHandler(doc) };
}
const edit = {type:'edit',version:1,path:['views','rows',0,'component','fields',0,'label'],value:'新'};
test('资源页面初始化、修改和文本变更同步接入 VS Code', async () => {
  const h=harness();await h.open();
  assert.match(h.panel.webview.html,/nonce-/);
  await h.send({type:'ready'});
  assert.equal(h.messages.at(-1).data.pageId,'PG-X');
  await h.send(edit);
  assert.equal(h.edits[0].text,'"新"');
  assert.equal(h.messages.at(-1).type,'applied');
  h.doc.version=2;h.changed();h.saved();
  assert.equal(h.messages.at(-1).version,2);
});
test('过期文档请求不会产生修改',async()=>{
  const h=harness();await h.open();h.doc.version=2;
  await h.send(edit);
  assert.equal(h.edits.length,0);
  assert.match(h.messages.at(-1).error,/文档已变化/);
});
test('连续的并发消息不能解除正在应用的文档锁',async()=>{
  const h=harness();await h.open();let release;
  h.setApply(()=>new Promise(resolve=>{release=resolve;}));
  const first=h.send(edit);
  await h.send(edit);
  const third=h.send(edit);
  assert.equal(h.edits.length,1);
  release(true);await first;await third;
});

test('原版设计器提交基线后精确同步，过期版本被拒绝',async()=>{
 const h=harness('platform');await h.open();await h.send({type:'ready'});
 const initial=h.messages.at(-1);assert.equal(initial.type,'document');
 const baseline=JSON.parse(h.doc.getText());await h.send({type:'nativeBaseline',version:1,baseline});
 const candidate=JSON.parse(JSON.stringify(baseline));candidate.views.rows[0].component.fields[0].label='新版';
 await h.send({type:'nativeEdit',version:1,candidate,requestId:'a'});
 assert.equal(h.edits.length,1);assert.equal(h.edits[0].text,'"新版"');assert.equal(h.messages.at(-1).type,'nativeApplied');
 h.doc.version=2;await h.send({type:'nativeEdit',version:1,candidate,requestId:'b'});assert.match(h.messages.at(-1).error,/文档已变化/);
});
test('原版设计器未初始化时不能直接保存候选页面',async()=>{
 const h=harness('platform');await h.open();await h.send({type:'nativeEdit',version:1,candidate:JSON.parse(h.doc.getText()),requestId:'x'});
 assert.equal(h.edits.length,0);assert.equal(h.messages.at(-1).type,'editError');
});
test('保存尚未完成时合并重复保存，并继续接受字段修改',async()=>{
 const h=harness('platform');await h.open();const baseline=JSON.parse(h.doc.getText());await h.send({type:'nativeBaseline',version:1,baseline});
 let finish;h.doc.save=()=>new Promise(resolve=>{finish=resolve;});
 const first=h.send({type:'nativeSaveDocument',version:1});await h.send({type:'nativeSaveDocument',version:1});
 const candidate=JSON.parse(JSON.stringify(baseline));candidate.views.rows[0].component.fields[0].label='保存中编辑';
 await h.send({type:'nativeEdit',version:1,candidate,requestId:'during-save'});
 finish(true);await first;
 assert.equal(h.edits.length,1);assert.equal(h.messages.some(m=>m.type==='editError'),false);
});
