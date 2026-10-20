'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
function instrumentBundle(raw,base){
 const prototype=/([\w$]+)\.a\.prototype\.\$api=([\w$]+),\1\.a\.prototype\.\$config=([\w$]+),\1\.a\.prototype\.\$gScript=([\w$]+)/.exec(raw);
 const publicPath=/\b([\w$]+)\.p="\/guthon\/"/g;
 const paths=[...raw.matchAll(publicPath)];
 if(!prototype || paths.length!==1)throw new Error('平台资源启动接口已变化，需要更新离线适配器。');
 const [,vue,api,config,script]=prototype;
 const startup=new RegExp('var [\\w$]+=new '+vue.replace(/\$/g,'\\$')+'\\.a\\(').exec(raw.slice(prototype.index));
 if(!startup)throw new Error('平台资源启动接口已变化，需要更新离线适配器。');
 const offset=prototype.index+startup.index;
 const validators=[...raw.matchAll(/([\w$]+)=\{checkGdpaasScript:function\(/g)].map(match=>match[1]);
 const hook=`window.__GUSHEN_INSTALL__({Vue:${vue}.a,api:${api},config:${config},script:${script},validators:[${validators.join(',')}],assetBase:${JSON.stringify(base)}});`;
 return (raw.slice(0,offset)+hook+raw.slice(offset)).replace(publicPath,(_,name)=>name+'.p='+JSON.stringify(base)).replace(/<\/script/gi,'<\\/script');
}
async function buildNativeHtml(extensionPath,resourceUri,nonce,cspSource,configuredRoot) {
 const root=configuredRoot||path.join(extensionPath,'platform-assets');
 const snapshot=JSON.parse(await fs.readFile(path.join(root,'snapshot.json'),'utf8'));
 const record=snapshot.files.find(file=>/^guthon\/js\/app\.[a-f0-9]+\.js$/.test(file.path));
 if(!record)throw new Error('资源包没有唯一主程序入口。');
 const raw=await fs.readFile(path.join(root,record.path),'utf8');
 if(crypto.createHash('sha256').update(raw).digest('hex')!==record.sha256)throw new Error('原版主程序校验失败，请重新下载资源。');
 const workers=await Promise.all(['editor.worker.js','ts.worker.js'].map(async name=>{
   const relative='guthon/'+name,entry=snapshot.files.find(file=>file.path===relative);
   if(!entry)throw new Error('平台资源缺少工作线程：'+name);
   const source=await fs.readFile(path.join(root,relative));
   if(crypto.createHash('sha256').update(source).digest('hex')!==entry.sha256)throw new Error('工作线程校验失败：'+name);
   return [name,source.toString('utf8')];
 }));
 // Inert JSON carries verified local sources; workers need no fetch/importScripts.
 const workerData=JSON.stringify(Object.fromEntries(workers)).replace(/</g,'\\u003c');
 const base=resourceUri(path.join(root,'guthon'))+'/';
 const script=instrumentBundle(raw,base);
 const original=await fs.readFile(path.join(root,'guthon/index.html'),'utf8');
 const sources=[...original.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match=>match[1]).filter(src=>!src.includes('/app.'));
 const styles=[...original.matchAll(/<link[^>]*href="([^"]+\.css)"[^>]*rel="stylesheet"/g)].map(match=>match[1]);
 const resource=reference=>resourceUri(path.join(root,reference.replace(/^\//,'')));
 const escape=value=>String(value).replace(/[&"<>]/g,char=>({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[char]));
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${escape(cspSource)}; style-src ${escape(cspSource)} 'unsafe-inline'; font-src ${escape(cspSource)} data:; img-src ${escape(cspSource)} data:; connect-src 'none'; worker-src ${escape(cspSource)} blob:; frame-src 'none';">
 ${styles.map(src=>`<link rel="stylesheet" href="${escape(resource(src))}">`).join('')}
 <link rel="stylesheet" href="${escape(resourceUri(path.join(extensionPath,'native-designer/bridge.css')))}">
 </head><body><div id="offline-bar"><span id="offline-status" role="status">正在启动原版设计器…</span></div><div id="app"></div>
 <script nonce="${nonce}" type="application/json" id="offline-worker-sources">${workerData}</script>
 <script nonce="${nonce}" src="${escape(resourceUri(path.join(extensionPath,'native-designer/bridge.js')))}"></script>
 ${sources.map(src=>`<script nonce="${nonce}" src="${escape(resource(src))}"></script>`).join('')}
 <script nonce="${nonce}">${script}</script></body></html>`;
}
module.exports={buildNativeHtml,instrumentBundle};
