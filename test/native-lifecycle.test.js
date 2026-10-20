'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
async function fixture(){
 const messages=[],events={},elements=new Map();let mutation,mixin,visible=[],model;
 const get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',addEventListener(name,fn){this[name]=fn;}});return elements.get(id);};
 const window={location:{hash:''},addEventListener:(name,fn)=>{events[name]=fn;}};
 const document={body:{},documentElement:{clientWidth:1400,clientHeight:900},querySelectorAll:()=>visible,getElementById:get,addEventListener(){}};
 class Observer{constructor(fn){mutation=fn;}observe(){}}
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../native-designer/bridge.js'),'utf8'),{window,document,MutationObserver:Observer,getComputedStyle:()=>({display:'block'}),acquireVsCodeApi:()=>({postMessage:m=>messages.push(m),getState:()=>null,setState(){}}),setInterval(){},setTimeout,queueMicrotask});
 window.__GUSHEN_INSTALL__({Vue:{mixin:v=>{mixin=v;},http:{interceptors:{unshift(){}}}},api:{},config:{},script:{}});
 const component={$options:{name:'dev-root',methods:{}},$refs:{workAreaPage:{version:'ready',page:{getPageContext:()=>model}}},$nextTick:()=>Promise.resolve(),initPage:text=>{model=JSON.parse(text);}};
 mixin.beforeCreate.call(component);Object.assign(component,component.$options.methods);component.postMessage({type:'ready'});
 const data={pageId:'PG-X',views:{rows:[{component:{fields:[{id:'f1',label:'原名'}]}}]}};
 events.message({data:{protocolVersion:1,type:'document',data,version:1}});
 for(let i=0;i<40&&!messages.some(m=>m.type==='nativeBaseline');i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.ok(messages.some(m=>m.type==='nativeBaseline'));
 return {messages,get,events,get model(){return model;},open(elements){visible=elements;mutation();}};
}
test('嵌套弹窗不吸收已有字段修改，确认后仍能同步',async()=>{
 const h=await fixture(),outer={},inner={};h.open([outer]);
 h.model.views.rows[0].component.fields[0].label='新名';h.open([outer,inner]);
 assert.equal(h.messages.filter(m=>m.type==='nativeBaseline').length,2);
 h.open([]);h.get('offline-save').click();
 assert.equal(h.messages.at(-1).type,'nativeEdit');assert.equal(h.messages.at(-1).candidate.views.rows[0].component.fields[0].label,'新名');
});
test('弹窗内编辑时收到外部文档变化，会保留输入并停止过期写入',async()=>{
 const h=await fixture();h.open([{}]);h.model.views.rows[0].component.fields[0].label='未确认输入';
 h.events.message({data:{protocolVersion:1,type:'document',data:{pageId:'PG-X',views:{rows:[]}},version:2}});
 assert.equal(h.model.views.rows[0].component.fields[0].label,'未确认输入');assert.match(h.get('offline-status').textContent,/已在其他位置变化/);
 h.open([]);h.get('offline-save').click();assert.equal(h.messages.some(m=>m.type==='nativeEdit'),false);
});
