'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function ui(savedState) {
  const nodes=new Map(),sent=[];let receive;
  function node() { return { value:'',disabled:false,children:[],handlers:{},
    addEventListener(name,fn){this.handlers[name]=fn;},replaceChildren(){this.children=[];},append(child){this.children.push(child);} }; }
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../designer-assets/editor.js'),'utf8'), {
    document:{getElementById:get,createElement:node},
    window:{addEventListener(name,fn){receive=fn;}},
    acquireVsCodeApi:()=>({postMessage:message=>sent.push(message),getState:()=>savedState,setState:value=>{savedState=value;}})
  });
  return {get,sent,send:message=>receive({data:{protocolVersion:1,...message}})};
}
const data={pageId:'PG-X',views:{rows:[{component:{name:'表单',fields:[{label:'客户',width:1}],params:{pageEvents:{onOpenScript:''},serviceEvents:{secret:'不展示'}}}}]}};
test('字段编辑发送原路径和版本，不向插件发出整页覆盖',()=>{
  const h=ui();assert.equal(h.sent[0].type,'ready');
  h.send({type:'document',data,version:5,dirty:false});
  const item=h.get('tree').children.find(x=>x.textContent.endsWith('label'));
  item.handlers.click();h.get('value').value='客户名称';h.get('value').handlers.input();h.get('apply').handlers.click();
  const message=h.sent.at(-1);
  assert.equal(message.type,'edit');assert.equal(message.version,5);assert.equal(message.value,'客户名称');
  assert.deepEqual(Array.from(message.path),['views','rows',0,'component','fields',0,'label']);
  assert.equal(message.data,undefined);
});
test('基础编辑器展示服务事件并发送准确的脚本路径',()=>{
 const h=ui();h.send({type:'document',data,version:3});
 const item=h.get('tree').children.find(x=>x.title.endsWith('/serviceEvents/secret'));assert.ok(item);item.handlers.click();
 assert.match(h.get('value-label').textContent,/服务/);
 h.get('value').value='新服务脚本';h.get('value').handlers.input();h.get('apply').handlers.click();
 assert.deepEqual(Array.from(h.sent.at(-1).path),['views','rows',0,'component','params','serviceEvents','secret']);assert.equal(h.sent.at(-1).value,'新服务脚本');
});
test('外部文档更新不覆盖尚未应用的输入，放弃后取最新版本',()=>{
  const h=ui();h.send({type:'document',data,version:1});
  h.get('tree').children[0].handlers.click();h.get('value').value='草稿';h.get('value').handlers.input();
  h.send({type:'document',data,version:2});assert.equal(h.get('value').value,'草稿');
  h.get('discard').handlers.click();
  h.get('value').value='新输入';h.get('value').handlers.input();h.get('apply').handlers.click();
  assert.equal(h.sent.at(-1).version,2);
});
test('非法数字输入不产生文档修改',()=>{
  const h=ui();h.send({type:'document',data,version:1});
  h.get('tree').children.find(x=>x.textContent.endsWith('width')).handlers.click();
  h.get('value').value='abc';h.get('value').handlers.input();h.get('apply').handlers.click();
  assert.equal(h.sent.length,1);
});

test('隐藏后重建界面能够恢复未应用草稿，且不覆盖新版本',()=>{
  const h=ui({path:['views','rows',0,'component','fields',0,'label'],value:'未应用草稿',version:1});
  h.send({type:'document',data,version:2});
  assert.equal(h.get('value').value,'未应用草稿');
  h.get('apply').handlers.click();
  assert.equal(h.sent.at(-1).version,1);
});
test('应用过程中暂时禁用输入，避免回执覆盖较新的输入',()=>{
  const h=ui();h.send({type:'document',data,version:1});
  h.get('tree').children[0].handlers.click();h.get('value').value='新值';h.get('value').handlers.input();h.get('apply').handlers.click();
  assert.equal(h.get('value').disabled,true);
  h.send({type:'editError',error:'文档已变化'});
  assert.equal(h.get('value').disabled,false);
  assert.equal(h.get('value').value,'新值');
});
