'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function fixture(){
 const messages=[],events={},elements=new Map(),blobs=new Map();let mixin,interceptor,networkCalls=0;
 const window={location:{hash:''},addEventListener:(name,handler)=>{events[name]=handler;}};
 const document={documentElement:{clientHeight:900,clientWidth:1400},getElementById:id=>{if(!elements.has(id))elements.set(id,{addEventListener(){},textContent:''});return elements.get(id);}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../native-designer/bridge.js'),'utf8'),{window,document,Blob,URL:{createObjectURL(blob){const uri='blob:test/'+blobs.size;blobs.set(uri,blob);return uri;},revokeObjectURL(){}},Worker:class{constructor(uri){this.blob=blobs.get(uri);}},acquireVsCodeApi:()=>({postMessage:m=>messages.push(m),getState:()=>null,setState(){}}),setInterval(){},setTimeout(fn,ms){if(ms<10000)return setTimeout(fn,ms);},queueMicrotask});
 const api={common:{getCssFileList(){throw new Error('network');}},danger:{save(){throw new Error('network');}}};
 const Vue={http:{interceptors:{unshift:fn=>{interceptor=fn;}}},mixin:obj=>{mixin=obj;}};
 const bundle=fs.readFileSync(path.join(__dirname,'../platform-assets/guthon/js/app.a42d4efa.js'),'utf8');
 const validator=vm.runInNewContext('('+bundle.match(/Wt=(\{checkGdpaasScript:function[\s\S]*?\}),Qt=Wt/)[1]+')',{
  oe:{isNull:v=>v==null||v==='',isFunction:v=>typeof v==='function'},qt:{encode:v=>v},K:{ROOT_PATH:''},
  s:{a:{http:{post(){networkCalls++;return {then(){}};}}}}
 });
 window.__GUSHEN_INSTALL__({Vue,api,config:{},script:{},validators:[validator]});
 return {window,messages,api,mixin,interceptor,elements,validator,get networkCalls(){return networkCalls;}};
}
test('在路由创建前设置离线入口，适配平台改写后的 dev-root 名称',()=>{
 const h=fixture();assert.equal(h.window.location.hash,'/dev-root');
 const component={$options:{name:'dev-root',methods:{postMessage(){throw new Error('original parent message');}}}};
 h.mixin.beforeCreate.call(component);component.$options.methods.postMessage.call(component,{type:'ready'});
 assert.equal(h.messages.at(-1).type,'ready');
});
test('离线调用不触发原始后端方法，未知写操作明确阻断',async()=>{
 const h=fixture();let value;
 h.api.common.getCssFileList(data=>{value=data;});await new Promise(resolve=>queueMicrotask(resolve));assert.equal(value.files.length,0);
 assert.doesNotThrow(()=>h.api.danger.save());assert.match(h.elements.get('offline-status').textContent,/danger.save/);
});
test('确认已有服务事件的按钮设置时，不调用在线脚本校验接口',async()=>{
 const h=fixture();let confirmed=false;
 const scripts=[{name:'beforeSave',script:'#set($value = 1);'}];
 h.validator.checkGdpaasScript(scripts,()=>{confirmed=true;});
 await new Promise(resolve=>queueMicrotask(resolve));
 assert.equal(h.networkCalls,0);assert.equal(confirmed,true);
 assert.equal(scripts.length,1);assert.equal(scripts[0].script,'#set($value = 1);');
});
test('脚本 workers 在不支持 importScripts 的 Webview 环境中仍能初始化语言服务',async()=>{
 const h=fixture(),sources=Object.fromEntries(['editor.worker.js','ts.worker.js'].map(name=>[name,fs.readFileSync(path.join(__dirname,'../platform-assets/guthon',name),'utf8')]));
 h.elements.set('offline-worker-sources',{textContent:JSON.stringify(sources)});
 for(const label of ['editorWorkerService','javascript','typescript']){
  const worker=h.window.MonacoEnvironment.getWorker('workerMain.js',label),replies=[];
  const sandbox={console,setTimeout,clearTimeout,setInterval,clearInterval,importScripts(){throw new Error('Webview 不支持 importScripts');},postMessage:m=>replies.push(m)};sandbox.self=sandbox;
  vm.runInNewContext(await worker.blob.text(),sandbox);
  sandbox.onmessage({data:'vs/editor/editor.worker'});
  async function request(id,method,args){sandbox.onmessage({data:{vsWorker:1,req:id,method,args}});await new Promise(resolve=>setImmediate(resolve));const reply=replies.find(m=>m.seq===id);assert.ok(reply);assert.equal(reply.err,undefined);return reply.res;}
  const methods=await request('1','$initialize',[1,null,'vs/editor/editorSimpleWorker',[]]);assert.ok(methods.includes('loadForeignModule'));
  if(label!=='editorWorkerService'){
   const languageMethods=await request('2','loadForeignModule',['vs/language/typescript/tsWorker',{compilerOptions:{},extraLibs:{}},[]]);
   assert.ok(languageMethods.includes('getSyntacticDiagnostics'));
   const uri='inmemory://model/test.ts';
   await request('3','acceptNewModel',[{url:uri,lines:['const answer = ;'],EOL:'\n',versionId:1}]);
   const diagnostics=await request('4','fmr',['getSyntacticDiagnostics',[uri]]);assert.ok(diagnostics.length>0);
  }
 }
});
