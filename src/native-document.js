'use strict';
const { inspect, createEdit } = require('./document');
const own = (object, key) => object !== null && typeof object === 'object' && Object.hasOwn(object, key);
const scalar = value => value === null || ['string','boolean','number'].includes(typeof value);
function permitted(path) {
  return (['views','pageSetup'].includes(path[0]) || (path[0] === 'modalSaveBnt' && path[1] === 'pageEvents')) &&
    (path.includes('fields') || path.includes('pageEvents')) &&
    !path.some(key => ['serviceEvents','datasource','pageId','guid','id','fieldId','__proto__','prototype','constructor'].includes(key));
}
function createNativeEdits(text, baseline, candidate) {
  const {data,spans} = inspect(text);
  if (baseline?.pageId !== data.pageId || candidate?.pageId !== data.pageId) throw new Error('设计器页面身份不匹配。');
  const updates = [], additions = new Map();
  function set(path, value) {
    if (!permitted(path) || !scalar(value) || (path.includes('pageEvents') && typeof value !== 'string')) {
      throw new Error('当前版本不支持此修改：/' + path.join('/'));
    }
    let parent=data, index=0;
    while (index<path.length && own(parent,path[index])) parent=parent[path[index++]];
    if (index===path.length) { updates.push(createEdit(text,path,value)); return; }
    if (!parent || typeof parent!=='object' || Array.isArray(parent)) throw new Error('不支持新增布局或字段。');
    const existingPath=path.slice(0,index), key=JSON.stringify(existingPath);
    if (!additions.has(key)) additions.set(key,{path:existingPath,values:Object.create(null),parent});
    let branch=additions.get(key).values;
    for (;index<path.length-1;index++) branch=branch[path[index]] ||= Object.create(null);
    branch[path.at(-1)]=value;
  }
  function diff(before, after, path) {
    if (Object.is(before,after)) return;
    if (path.some(key=>['superPageEvents','superServiceEvents'].includes(key))) return;
    if (after===undefined) {
      let original=data,exists=true;
      for(const key of path){if(!own(original,key)){exists=false;break;}original=original[key];}
      if(!exists || (before && typeof before==='object' && Object.keys(before).length===0)) return;
    }
    if (Array.isArray(before) || Array.isArray(after)) {
      if (!Array.isArray(before) || !Array.isArray(after) || before.length!==after.length) throw new Error('不支持数组或布局增删：/'+path.join('/'));
      before.forEach((value,index)=>diff(value,after[index],[...path,index]));return;
    }
    if (after && typeof after==='object' && (before===undefined || (before && typeof before==='object'))) {
      for(const key of new Set([...Object.keys(before||{}),...Object.keys(after)])) {
        if (['__proto__','prototype','constructor'].includes(key)) throw new Error('不支持此属性名。');
        diff(own(before,key)?before[key]:undefined,own(after,key)?after[key]:undefined,[...path,key]);
      }
      return;
    }
    if (after===undefined && path.includes('pageEvents') && typeof before==='string') {set(path,'');return;}
    if (after===undefined) throw new Error('不支持删除属性：/'+path.join('/'));
    set(path,after);
  }
  diff(baseline,candidate,[]);
  for(const addition of additions.values()) {
    const span=spans.get(JSON.stringify(addition.path));
    if (!span) throw new Error('无法定位新增属性。');
    const content=JSON.stringify(addition.values).slice(1,-1);
    updates.push({start:span.end-1,end:span.end-1,text:(Object.keys(addition.parent).length?',':'')+content});
  }
  return updates.sort((a,b)=>b.start-a.start);
}
module.exports={createNativeEdits};
