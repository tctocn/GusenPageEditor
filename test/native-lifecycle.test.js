'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
async function fixture(systemId){
 const messages=[],events={},elements=new Map();let mutation,mixin,visible=[],model;
 const get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',addEventListener(name,fn){this[name]=fn;}});return elements.get(id);};
 const window={location:{hash:''},addEventListener:(name,fn)=>{events[name]=fn;}};
 const document={body:{},documentElement:{clientWidth:1400,clientHeight:900},querySelectorAll:()=>visible,getElementById:get,addEventListener(){}};
 class Observer{constructor(fn){mutation=fn;}observe(){}}
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../native-designer/bridge.js'),'utf8'),{window,document,MutationObserver:Observer,getComputedStyle:()=>({display:'block'}),acquireVsCodeApi:()=>({postMessage:m=>messages.push(m),getState:()=>null,setState(){}}),setInterval(){},setTimeout,queueMicrotask});
 window.__GUSHEN_INSTALL__({Vue:{mixin:v=>{mixin=v;},http:{interceptors:{unshift(){}}}},api:{},config:{},script:{}});
 // Use the snapshot's actual Vuex module so mutation names and state match the UI.
 const bundle=fs.readFileSync(path.join(__dirname,'../platform-assets/guthon/js/app.a42d4efa.js'),'utf8');
 const module=vm.runInNewContext('('+bundle.match(/Iz=(\{state:\{devSelectedItem:[\s\S]*?\}),xz=Iz;/)[1]+')');
 const store={state:{modeDev:module.state},commit(name,value){module.mutations[name](module.state,value);}};
 let initializedSystem,platformSaves=0;
 const platformSave=vm.runInNewContext('('+bundle.match(/save:(function\(\)\{this\.page\.save\(this\.pageVersion,this\.isAutoCompile\?1:0,this\.isIframe\)\})/)[1]+')');
 const work={version:'ready',page:{getPageContext:()=>model,save(){platformSaves++;}},$options:{props:{isIframe:Boolean},methods:{initPage(){},save:platformSave}}};
 mixin.beforeCreate.call(work);Object.assign(work,work.$options.methods);
 const component={$store:store,$options:{name:'dev-root',methods:{}},$refs:{workAreaPage:work},$nextTick:()=>Promise.resolve(),initPage:text=>{initializedSystem=store.state.modeDev.systemId;model=JSON.parse(text);}};
 mixin.beforeCreate.call(component);Object.assign(component,component.$options.methods);component.postMessage({type:'ready'});
 const data={pageId:'PG-X',views:{rows:[{component:{fields:[{id:'f1',label:'原名'}]}}]}};
 events.message({data:{protocolVersion:1,type:'document',data,version:1,systemId}});
 for(let i=0;i<40&&!messages.some(m=>m.type==='nativeBaseline');i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.ok(messages.some(m=>m.type==='nativeBaseline'));
 return {messages,get,events,store,bundle,toolbarSave(){work.save();},get platformSaves(){return platformSaves;},save(){events.keydown({ctrlKey:true,key:'s',preventDefault(){}});},get initializedSystem(){return initializedSystem;},get model(){return model;},open(elements){visible=elements;mutation();}};
}
test('右上角保存按钮直接保存本地 JSON，不调用原版页面保存',async()=>{
 const h=await fixture();h.toolbarSave();
 assert.equal(h.messages.at(-1).type,'nativeSaveDocument');assert.equal(h.platformSaves,0);
});
test('右上角保存按钮等待 JSON 修改应用完成后再保存最新版本',async()=>{
 const h=await fixture();h.model.views.rows[0].component.fields[0].label='新名';h.toolbarSave();
 const edit=h.messages.at(-1);assert.equal(edit.type,'nativeEdit');
 assert.equal(h.messages.some(m=>m.type==='nativeSaveDocument'),false);
 h.events.message({data:{protocolVersion:1,type:'nativeApplied',requestId:edit.requestId,version:2}});
 assert.equal(h.messages.at(-1).type,'nativeSaveDocument');assert.equal(h.messages.at(-1).version,2);assert.equal(h.platformSaves,0);
});
test('离线初始化后，原版数据源按钮能打开页面中已有的数据源',async()=>{
 const h=await fixture('SYS-TEST');
 assert.equal(h.initializedSystem,'SYS-TEST');
 const source=h.bundle.match(/dataSourceSet:(function\(\)\{var e=this\.\$store\.state\.modeDev\.dataSourceId;this\.\$gUtil\.isNull\(e\)\?this\.\$gUtil\.error\("请选择系统"\):this\.\$refs\.tableSetPage\.show\(e,this\.datasource,"inputform"\)\})/)[1];
 const open=vm.runInNewContext('('+source+')');
 const datasource={sql:'select ID from DEMO',fields:[{fdId:'ID'}]};let shown;
 open.call({$store:h.store,datasource,$gUtil:{isNull:v=>v==null||v==='',error:message=>assert.fail(message)},$refs:{tableSetPage:{show:(...args)=>{shown=args;}}}});
 assert.equal(shown[0],'offline');assert.equal(shown[1],datasource);assert.equal(shown[2],'inputform');
 h.save();assert.equal(h.messages.at(-1).type,'nativeSaveDocument');
});
test('无系统目录的独立页面使用离线上下文，重载时更新系统状态',async()=>{
 const h=await fixture();assert.equal(h.initializedSystem,'offline');
 h.events.message({data:{protocolVersion:1,type:'document',data:JSON.parse(JSON.stringify(h.model)),version:2,systemId:'SYS-NEXT'}});
 for(let i=0;i<40&&!h.messages.some(m=>m.type==='nativeBaseline'&&m.version===2);i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(h.initializedSystem,'SYS-NEXT');assert.equal(h.store.state.modeDev.dataSourceId,'offline');
});
test('嵌套弹窗不吸收已有字段修改，确认后仍能同步',async()=>{
 const h=await fixture(),outer={},inner={};h.open([outer]);
 h.model.views.rows[0].component.fields[0].label='新名';h.open([outer,inner]);
 assert.equal(h.messages.filter(m=>m.type==='nativeBaseline').length,2);
 h.open([]);h.save();
 assert.equal(h.messages.at(-1).type,'nativeEdit');assert.equal(h.messages.at(-1).candidate.views.rows[0].component.fields[0].label,'新名');
});
test('弹窗内编辑时收到外部文档变化，会保留输入并停止过期写入',async()=>{
 const h=await fixture();h.open([{}]);h.model.views.rows[0].component.fields[0].label='未确认输入';
 h.events.message({data:{protocolVersion:1,type:'document',data:{pageId:'PG-X',views:{rows:[]}},version:2}});
 assert.equal(h.model.views.rows[0].component.fields[0].label,'未确认输入');assert.match(h.get('offline-status').textContent,/已在其他位置变化/);
 h.open([]);h.save();assert.equal(h.messages.some(m=>m.type==='nativeEdit'),false);
});
