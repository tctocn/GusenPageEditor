'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
let api;
try { api = require('../src/assets'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; api = {}; }
test('内置资源可以加载且不残留模板占位符', async () => {
  assert.equal(typeof api.loadAssets,'function');
  const assets = await api.loadAssets(path.join(__dirname,'../designer-assets'));
  const html = api.renderHtml(assets.html,{ baseUri:'vscode-resource://local/', cspSource:'vscode-resource:', nonce:'random' });
  assert.match(html,/Content-Security-Policy/);
  assert.match(html,/vscode-resource:\/\/local\//);
  assert.doesNotMatch(html,/\{\{/);
});
test('拒绝不兼容资源协议和目录逃逸', () => {
  assert.throws(() => api.validateManifest({protocolVersion:2, entry:'index.html'}), /协议/);
  assert.throws(() => api.validateManifest({protocolVersion:1, entry:'../index.html'}), /入口/);
  assert.throws(() => api.validateManifest({protocolVersion:1, entry:'/etc/passwd'}), /入口/);
});
