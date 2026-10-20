'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inspect, createEdit } = require('../src/document');
const root=process.env.GUSHEN_SOURCE_ROOT ? path.resolve(process.env.GUSHEN_SOURCE_ROOT) : path.join(__dirname,'fixtures/source');
test('只读验证页面语料：解析和字段修改仅改变目标值', {skip:!fs.existsSync(root)}, t=>{
  const files=[...fs.globSync('systems/*/pages/**/*.json',{cwd:root})];
  assert.ok(files.length>0);
  let changed=0;
  for(const file of files) {
    const source=fs.readFileSync(path.join(root,file),'utf8');
    const {data,spans}=inspect(source);
    assert.ok(data.pageId,file);
    for(const key of spans.keys()) {
      const pointer=JSON.parse(key);
      if(pointer.at(-1)!=='label' || !pointer.includes('fields') || pointer.includes('datasource'))continue;
      let previous=data;
      for(const part of pointer)previous=previous[part];
      if(typeof previous!=='string')continue;
      const edit=createEdit(source,pointer,previous+'测试');
      const output=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
      assert.doesNotThrow(()=>JSON.parse(output),file);
      assert.equal(output.slice(0,edit.start),source.slice(0,edit.start),file);
      assert.equal(output.slice(edit.start+edit.text.length),source.slice(edit.end),file);
      changed++;break;
    }
  }
  t.diagnostic(`已解析 ${files.length} 个页面；在内存中验证 ${changed} 个页面的精确字段修改，未写回业务文件。`);
});
