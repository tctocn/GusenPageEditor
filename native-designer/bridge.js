'use strict';
(() => {
 // Vue Router snapshots the hash when its instance is constructed, before install.
 window.location.hash='/dev-root';
 const vscode=acquireVsCodeApi(),clone=value=>JSON.parse(JSON.stringify(value));
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const post=message=>vscode.postMessage({protocolVersion:1,...message});
 const status=text=>{document.getElementById('offline-status').textContent=text;};
 const user={userId:'offline-local',userName:'本地编辑',isAdmin:1};
 let vm,documentState,latest,baseline,pending,normalization,loading=false,conflict=false,wantSave=false,saving=false,loadId=0,request=0;
 const unsupported=new Set();
 const context=()=>vm?.$refs.workAreaPage?.page?.getPageContext(true);
 const dialogs=()=>Array.from(document.querySelectorAll?.('.el-dialog__wrapper')||[]).filter(element=>getComputedStyle(element).display!=='none');
 function dialogBaseline(element){
   const current=clone(context());let owner=element?.__vue__;
   while(owner && !owner.$refs?.gdInputArea)owner=owner.$parent;
   const form=owner?.$refs.gdInputArea?.form,field=owner?.field;
   if(!form || !field?.id)return current;
   const initialized=clone(form);
   if(Array.isArray(initialized.validId))initialized.validId=initialized.validId.length?initialized.validId.join(';')+';':'';
   initialized.pageEvents=clone(owner.form.pageEvents||{});
   function walk(value){
     if(!value||typeof value!=='object')return;
     if(Array.isArray(value.fields))for(const item of value.fields)if(item.id===field.id)Object.assign(item,initialized);
     for(const child of Object.values(value))if(child&&typeof child==='object')walk(child);
   }
   walk(current);return current;
 }
 function callback(args,result){const cb=args.find(value=>typeof value==='function');if(cb)queueMicrotask(()=>cb(clone(result)));}
 function unavailable(name){if(!unsupported.has(name)){unsupported.add(name);status('离线模式：'+name+' 暂无本地数据或不支持执行。');}return undefined;}
 function configure(api) {
   const local={
    'common.getCssFileList':()=>({files:[]}),
    'common.login.getSystemInitVar':()=>({cloudpath:'',debuggerUrl:'',devConstants:{}}),
    'common.loadAllCodes':()=>({codes:{}}),'common.loadCodes':()=>({codes:[]}),
    'common.getSetting':()=>({value:''}),
    'basesetup.fieldTemplate.getAllList':()=>({list:[]}),
    'common.getCodesTitles':()=>({list:[]}),
    'systems.resourcefile.getSystemResourceFiles':()=>({list:[]}),
    'develop.uicomp.getCompNames':()=>({list:[]}),
    'debugConfig.getScriptDebugCache':()=>({list:[],lineNumbers:[]}),
    'develop.pages.getPageBaseInfo':()=>({page:{pageId:documentState?.data.pageId,pageType:documentState?.data.pageType,version:1,systemId:documentState?.systemId||'offline',checkOutUserId:user.userId}})
   };
   function walk(object,path=[]){for(const key of Object.keys(object)){const value=object[key],name=[...path,key].join('.');if(typeof value==='function')object[key]=(...args)=>local[name]?callback(args,local[name](args)):unavailable(name);else if(value&&typeof value==='object')walk(value,[...path,key]);}}
   walk(api);
 }
 async function load(message) {
   if(!vm){latest=message;return;}
   const id=++loadId;loading=true;conflict=false;documentState=message;latest=message;baseline=null;
   vm.isLoadOk=false;await vm.$nextTick();
   vm.initPage(JSON.stringify(message.data));
   for(let i=0;i<40;i++) {
     await new Promise(resolve=>setTimeout(resolve,50));
     if(id!==loadId)return;
     const work=vm.$refs.workAreaPage;
     if(work?.version && context()){
       work.isCheckOut=true;
       baseline=clone(context());loading=false;
       post({type:'nativeBaseline',version:message.version,baseline});
       status('原版设计器已就绪 · 字段与前端事件修改会同步到当前文档');
       const draft=vscode.getState();
       if(draft?.candidate && draft.pageId===message.data.pageId){
         if(draft.version===message.version){try{await restoreDraft(draft.candidate);}catch(e){status(e.message);}}
         else status('有旧版本设计器草稿，未自动覆盖当前文档。');
       }
       return;
     }
   }
   loading=false;status('设计器未能完成初始化，请切换到内置编辑模式。');
 }
 async function restoreDraft(candidate){
   const work=vm.$refs.workAreaPage;
   work.initPage(documentState.data.pageId,documentState.data.pageType,clone(candidate),1,documentState.systemId||'offline');
   await work.$nextTick();
 }
 function sync(save=false){
   if(save)wantSave=true;
   if(loading || pending || conflict || !baseline || dialogs().length)return;
   let candidate;try{candidate=context();}catch(e){status(e.message);return;}
   if(!candidate)return;
   if(same(candidate,baseline)){
     if(wantSave && !saving){wantSave=false;saving=true;post({type:'nativeSaveDocument',version:documentState.version});}return;
   }
   pending={candidate:clone(candidate),version:documentState.version,requestId:String(++request)};
   vscode.setState({pageId:documentState.data.pageId,version:documentState.version,candidate:pending.candidate});
   post({type:'nativeEdit',candidate:pending.candidate,version:pending.version,requestId:pending.requestId});
   status('正在同步字段与前端事件…');
 }
 window.__GUSHEN_INSTALL__=({Vue,api,config,script,assetBase})=>{
   configure(api);
   window.MonacoEnvironment={getWorker(moduleId,label){
     const filename=['javascript','typescript'].includes(label)?'ts.worker.js':'editor.worker.js';
     const uri=URL.createObjectURL(new Blob(['importScripts('+JSON.stringify(assetBase+filename)+');'],{type:'text/javascript'}));
     const worker=new Worker(uri);
     setTimeout(()=>URL.revokeObjectURL(uri),10000);
     return worker;
   }};
   script.getUserId=()=>user.userId;script.getUser=()=>user;script.checkLogin=(page,cb)=>cb?.();
   script.initPageCodes=(page,type,cb)=>cb?.([]);
   script.initListCodes=(page,type,cb)=>cb?.([]);
   config.CLOUD_PATH='';config.WEB_SOCKET_PATH='';
   Vue.http.interceptors.unshift((request,next)=>{unavailable(request.url);next(request.respondWith(JSON.stringify({code:1,message:'离线模式不执行网络请求'}),{status:200,headers:{'Content-Type':'application/json'}}));});
   Vue.mixin({beforeCreate(){
     if(['iframe-develop-root','dev-root'].includes(this.$options.name)){
       this.$options.methods={...this.$options.methods,
         postMessage(message){if(message.type==='ready'){vm=this;if(latest)void load(latest);else post({type:'ready'});}},
         onIframeSave(){sync(true);},
         resize(){this.workAreaHeight=document.documentElement.clientHeight-44+32;this.workAreaWidth=document.documentElement.clientWidth-500;}
       };
     }
     // The application's custom stylesheet query is online-only.
     if(this.$options.methods?.loadCssFile)this.$options.methods={...this.$options.methods,loadCssFile(){}};
   }});
   window.location.hash='/dev-root';
 };
 window.addEventListener('message',event=>{
   const message=event.data;if(message?.protocolVersion!==1)return;
   if(message.type==='document'){
     latest=message;
     if(!baseline || loading){if(!loading)void load(message);return;}
     if(pending)return;
     if(message.version===documentState.version)return;
     if(!dialogs().length && same(context(),baseline))void load(message);
     else{conflict=true;status('JSON 已在其他位置变化；设计器修改已保留，请处理后重载。');}
   }else if(message.type==='documentError'){conflict=true;status(message.error);}
   else if(message.type==='nativeApplied' && pending && message.requestId===pending.requestId){
     baseline=pending.candidate;documentState={...documentState,version:message.version};pending=null;vscode.setState(null);status('修改已同步到文档 · 保存后可提交 SVN');
     if(normalization){baseline=normalization;normalization=null;post({type:'nativeBaseline',version:documentState.version,baseline});}
     sync(wantSave);
   }else if(message.type==='editError'){
     pending=null;conflict=true;status(message.error+'；当前设计器输入已保留。');
   }else if(message.type==='nativeSaved'){
     saving=false;status(message.saved&&!message.dirty?'JSON 已保存，可使用现有 SVN 工具提交。':'文档仍有未保存修改，请再次保存。');
     if(wantSave)sync(true);
   }else if(message.type==='nativeSaveError'){saving=false;wantSave=false;status(message.error);}
 });
 document.getElementById('offline-save').addEventListener('click',()=>sync(true));
 document.getElementById('offline-reload').addEventListener('click',()=>{if(pending){status('请等待当前修改完成。');return;}vscode.setState(null);if(latest)void load(latest);});
 window.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();sync(true);}},true);
 // Dialog init mutates missing defaults on the platform's live field objects.
 // Capture those defaults before typing; opening a dialog must not dirty JSON.
 if(typeof MutationObserver!=='undefined'){
   let visible=new Set(),scriptView=false;
   new MutationObserver(()=>{
     const now=new Set(dialogs()),opened=visible.size===0 && now.size>0;visible=now;
     const scriptPane=document.getElementById('pane-page-script');
     const inScriptView=Boolean(scriptPane && getComputedStyle(scriptPane).display!=='none');
     const enteredScriptView=inScriptView&&!scriptView;scriptView=inScriptView;
     if((opened || enteredScriptView) && baseline && !loading && !conflict){
       const current=opened?dialogBaseline(Array.from(now)[0]):context();if(!current)return;
       if(pending)normalization=clone(current);
       else{baseline=clone(current);post({type:'nativeBaseline',version:documentState.version,baseline});}
     }
   }).observe(document.body,{subtree:true,attributes:true,childList:true});
   document.addEventListener('click',event=>{if(!event.target.closest('#offline-bar'))sync(false);},true);
 }
 setInterval(()=>sync(false),700);
 window.addEventListener('error',event=>status('设计器错误：'+event.message));
})();
