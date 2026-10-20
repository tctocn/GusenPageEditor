'use strict';
const vscode=require('vscode'),path=require('node:path'),crypto=require('node:crypto');
const {inspect}=require('./document');const {createNativeEdits}=require('./native-document');const {buildNativeHtml}=require('./upstream');
async function resolveNativeEditor(context,document,panel){
 const configured=vscode.workspace.getConfiguration('gushen',document.uri).get('platformAssetsPath','');
 if(configured&&!path.isAbsolute(configured))throw new Error('平台资源目录需要使用绝对路径。');
 const root=configured||path.join(context.extensionPath,'platform-assets');
 panel.webview.options={enableScripts:true,localResourceRoots:[vscode.Uri.file(root),vscode.Uri.file(path.join(context.extensionPath,'native-designer'))]};
 const post=message=>panel.webview.postMessage({protocolVersion:1,...message});
 let session=null,busy=false,saving=false;
 const sync=()=>{try{return post({type:'document',data:inspect(document.getText()).data,version:document.version,dirty:document.isDirty,systemId:/(?:^|[\\/])systems[\\/]([^\\/]+)/.exec(document.uri.fsPath||'')?.[1]||'offline'});}catch(error){return post({type:'documentError',error:error.message,version:document.version});}};
 const messages=panel.webview.onDidReceiveMessage(async message=>{
   if(!message||message.protocolVersion!==1)return;
   if(message.type==='ready'){await sync();return;}
   if(message.type==='nativeBaseline'){
     try{if(message.version===document.version && message.baseline?.pageId===inspect(document.getText()).data.pageId)session={baseline:message.baseline,version:message.version};}
     catch(error){await post({type:'documentError',error:error.message,version:document.version});}
     return;
   }
   if(message.type==='nativeSaveDocument'){
     if(saving)return;
     saving=true;
     try{
       if(message.version!==document.version)throw new Error('文档已变化，请同步后再次保存。');
       const saved=await document.save();await post({type:'nativeSaved',saved,dirty:document.isDirty});
       if(saved&&!document.isDirty)void vscode.window.showInformationMessage('JSON 保存成功。');
     }catch(error){await post({type:'nativeSaveError',error:error.message});}
     finally{saving=false;}
     return;
   }
   if(!['nativeEdit','nativeSaveDocument'].includes(message.type))return;
   if(busy){await post({type:'editError',requestId:message.requestId,error:'文档修改尚未完成，请稍后重试。'});return;}
   busy=true;
   try{
     if(message.version!==document.version)throw new Error('文档已变化，请先处理冲突后重载设计器。');
     if(!session || session.version!==message.version)throw new Error('设计器尚未完成初始化，请重载后重试。');
     const edits=createNativeEdits(document.getText(),session.baseline,message.candidate);
     if(edits.length){
       const change=new vscode.WorkspaceEdit();
       for(const edit of edits)change.replace(document.uri,new vscode.Range(document.positionAt(edit.start),document.positionAt(edit.end)),edit.text);
       if(!await vscode.workspace.applyEdit(change))throw new Error('无法将设计器修改应用到当前文档。');
     }
     session={baseline:message.candidate,version:document.version};
     await post({type:'nativeApplied',requestId:message.requestId,version:document.version});
   }catch(error){await post({type:'editError',requestId:message.requestId,error:error.message});}
   finally{busy=false;}
 });
 const changes=vscode.workspace.onDidChangeTextDocument(event=>{if(event.document.uri.toString()===document.uri.toString())void sync();});
 const saves=vscode.workspace.onDidSaveTextDocument(saved=>{if(saved.uri.toString()===document.uri.toString())void sync();});
 panel.onDidDispose(()=>{messages.dispose();changes.dispose();saves.dispose();});
 panel.webview.html=await buildNativeHtml(context.extensionPath,p=>panel.webview.asWebviewUri(vscode.Uri.file(p)).toString(),crypto.randomBytes(24).toString('hex'),panel.webview.cspSource,root);
}
module.exports={resolveNativeEditor};
