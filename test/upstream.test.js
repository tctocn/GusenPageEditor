'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const vm=require('node:vm');const fs=require('node:fs');
let api;try{api=require('../src/upstream');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;api={};}
test('原始资源不改写，生成隔离离线入口并验证启动适配点',async()=>{
 assert.equal(typeof api.buildNativeHtml,'function');
 const html=await api.buildNativeHtml(path.join(__dirname,'..'),p=>'https://local.test/'+path.relative(path.join(__dirname,'..'),p).split(path.sep).join('/'),'nonce123','https://local.test');
 assert.match(html,/__GUSHEN_INSTALL__/);assert.match(html,/path:"\/dev-root"/);assert.match(html,/connect-src 'none'/);assert.doesNotMatch(html,/r\.p="\/guthon\/"/);assert.match(html,/native-designer\/bridge.js/);
 const workers=JSON.parse(html.match(/id="offline-worker-sources">([\s\S]*?)<\/script>/)[1]);
 for(const name of ['editor.worker.js','ts.worker.js'])assert.equal(workers[name],fs.readFileSync(path.join(__dirname,'../platform-assets/guthon',name),'utf8'));
});
test('小版本构建变量改名后仍能识别启动接口，接口缺失时明确拒绝',()=>{
 assert.equal(typeof api.instrumentBundle,'function');
 const raw='q.p="/guthon/";v.a.prototype.$api=api2,v.a.prototype.$config=cfg2,v.a.prototype.$gScript=script2;var root2=new v.a({});';
 const result=api.instrumentBundle(raw,'local-resource/');assert.match(result,/Vue:v.a,api:api2,config:cfg2,script:script2/);assert.match(result,/q.p="local-resource\/"/);
 assert.throws(()=>api.instrumentBundle('unknown build','x'),/适配器/);
});
test('启动适配将脚本校验器交给离线桥接，兼容构建变量改名',()=>{
 const raw='q.p="/guthon/";var renamed={checkGdpaasScript:function(){throw new Error("online");}};v.a.prototype.$api=api2,v.a.prototype.$config=cfg2,v.a.prototype.$gScript=script2;var root2=new v.a({});';
 let confirmed=false;
 const sandbox={q:{},v:{a:function(){}},api2:{},cfg2:{},script2:{},window:{__GUSHEN_INSTALL__({validators}){
  validators.forEach(validator=>{validator.checkGdpaasScript=()=>{confirmed=true;};});
 }}};
 vm.runInNewContext(api.instrumentBundle(raw,'local-resource/'),sandbox);
 sandbox.renamed.checkGdpaasScript();assert.equal(confirmed,true);
});
