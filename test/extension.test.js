'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function harness(mode="basic") {
  let provider, receive, changeHandler, saveHandler, apply;
  const messages = [], edits = [], commands = new Map(), opened = [], errors = [], notifications = [];
  const disposable = () => ({ dispose() {} });
  const doc = { version:1, isDirty:false, isClosed:false, uri:{ toString:()=> 'file://page' },
    save:async()=>true, getText:()=> '{"pageId":"PG-X","views":{"rows":[{"component":{"fields":[{"label":"旧"}]}}]}}', positionAt: offset => offset };
  const vscode = {
    Uri: { file: fsPath => ({ fsPath, toString:()=>fsPath }) }, Range: class { constructor(start,end) {this.start=start;this.end=end;} },
    WorkspaceEdit: class { replace(uri,range,text) {this.range=range;this.text=text;} },
    commands: { registerCommand(id,handler) {commands.set(id,handler);return disposable();}, async executeCommand(...args){opened.push(args);} },
    window: { registerCustomEditorProvider(type, value) { provider=value; return disposable(); }, showErrorMessage:message=>errors.push(message),showInformationMessage:message=>notifications.push(message) },
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
  return { doc,panel,messages,edits,opened,errors,notifications,openFromMenu:uri=>commands.get('gushen.openPageEditor')?.(uri),setActive:uri=>{vscode.window.activeTextEditor=uri?{document:{uri}}:undefined;},async open() {await provider.resolveCustomTextEditor(doc,panel);},
    send: message=>receive({protocolVersion:1, ...message}), setApply: fn=>{apply=fn;},
    changed:()=>changeHandler({document:doc}), saved:()=>saveHandler(doc) };
}
const edit = {type:'edit',version:1,path:['views','rows',0,'component','fields',0,'label'],value:'新'};
test('右键打开指定 PG 页面，优先使用菜单文件而非当前编辑器',async()=>{
 const h=harness(),target={path:'/source/pages/PG-TEST.json'};h.setActive({path:'/source/pages/PG-OTHER.json'});
 await h.openFromMenu(target);
 assert.equal(h.opened.length,1);assert.equal(h.opened[0][0],'vscode.openWith');assert.equal(h.opened[0][1],target);assert.equal(h.opened[0][2],'gushen.pageEditor');assert.equal(h.opened[0][3].preview,false);
});
test('未传菜单文件时，通过当前 JSON 文档打开谷神编辑器',async()=>{
 const h=harness(),target={path:'/source/pages/PG-ACTIVE.json'};h.setActive(target);await h.openFromMenu();
 assert.equal(h.opened.length,1);assert.equal(h.opened[0][1],target);
});
test('没有文件或选择普通 JSON 时，不尝试打开谷神编辑器',async()=>{
 const h=harness();await h.openFromMenu();await h.openFromMenu({path:'/source/settings.json'});
 assert.equal(h.opened.length,0);assert.equal(h.errors.length,2);
});
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
test('JSON 保存成功后显示通知，尚未完成时不提前提示',async()=>{
 const h=harness('platform');await h.open();let finish;
 h.doc.save=()=>new Promise(resolve=>{finish=resolve;});
 const saving=h.send({type:'nativeSaveDocument',version:1});
 assert.equal(h.notifications.length,0);finish(true);await saving;
 assert.deepEqual(h.notifications,['JSON 保存成功。']);assert.equal(h.messages.at(-1).type,'nativeSaved');
});
test('保存失败、仍有修改或版本过期时，不显示成功通知',async()=>{
 for(const mode of ['cancelled','dirty','error','stale']){
  const h=harness('platform');await h.open();
  h.doc.save=async()=>{if(mode==='error')throw new Error('保存失败');return mode!=='cancelled';};
  h.doc.isDirty=mode==='dirty';if(mode==='stale')h.doc.version=2;
  await h.send({type:'nativeSaveDocument',version:1});assert.equal(h.notifications.length,0);
 }
});
test('按钮服务事件修改应用到 JSON 后可以保存并收到成功通知',async()=>{
 const h=harness('platform'),baseline={pageId:'PG-X',views:{rows:[{component:{buttons:[{id:'new'},{id:'save',serviceEvents:{beforeSaveScript:'old'}}]}}]}};
 h.doc.getText=()=>JSON.stringify(baseline);await h.open();await h.send({type:'nativeBaseline',version:1,baseline});
 const candidate=JSON.parse(JSON.stringify(baseline));candidate.views.rows[0].component.buttons[1].serviceEvents.beforeSaveScript='new';
 await h.send({type:'nativeEdit',version:1,candidate,requestId:'service'});
 assert.equal(h.messages.at(-1).type,'nativeApplied');assert.equal(h.edits[0].text,'"new"');
 await h.send({type:'nativeSaveDocument',version:1});assert.equal(h.messages.at(-1).type,'nativeSaved');assert.equal(h.notifications.length,1);
});
