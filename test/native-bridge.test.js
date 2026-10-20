'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function fixture(){
 const messages=[],events={},elements=new Map();let mixin,interceptor;
 const window={location:{hash:''},addEventListener:(name,handler)=>{events[name]=handler;}};
 const document={documentElement:{clientHeight:900,clientWidth:1400},getElementById:id=>{if(!elements.has(id))elements.set(id,{addEventListener(){},textContent:''});return elements.get(id);}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../native-designer/bridge.js'),'utf8'),{window,document,acquireVsCodeApi:()=>({postMessage:m=>messages.push(m),getState:()=>null,setState(){}}),setInterval(){},setTimeout,queueMicrotask});
 const api={common:{getCssFileList(){throw new Error('network');}},danger:{save(){throw new Error('network');}}};
 const Vue={http:{interceptors:{unshift:fn=>{interceptor=fn;}}},mixin:obj=>{mixin=obj;}};
 window.__GUSHEN_INSTALL__({Vue,api,config:{},script:{}});
 return {window,messages,api,mixin,interceptor,elements};
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
