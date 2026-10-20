'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
function validateManifest(manifest) {
  if (manifest?.protocolVersion !== 1) throw new Error('资源包通信协议不兼容，需要 protocolVersion: 1。');
  if (typeof manifest.entry !== 'string' || !/^[a-zA-Z0-9_/-]+\.html$/.test(manifest.entry) ||
      path.posix.isAbsolute(manifest.entry) || manifest.entry.split('/').includes('..')) {
    throw new Error('资源入口必须是包内的相对 HTML 路径。');
  }
  return manifest;
}
async function loadAssets(directory) {
  const root = await fs.realpath(directory);
  const manifest = validateManifest(JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8')));
  const entry = await fs.realpath(path.join(root, manifest.entry));
  const relative = path.relative(root, entry);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('资源入口不能位于包外。');
  const html = await fs.readFile(entry, 'utf8');
  for (const token of ['{{baseUri}}', '{{cspSource}}', '{{nonce}}']) {
    if (!html.includes(token)) throw new Error('资源入口缺少模板标记：' + token);
  }
  if (!/http-equiv=["']Content-Security-Policy["']/i.test(html)) throw new Error('资源入口缺少内容安全策略。');
  return { root, entry, manifest, html };
}
function renderHtml(html, values) {
  const escape = value => String(value).replace(/[&"<>']/g, char => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;',"'":'&#39;'}[char]));
  return html.replace(/\{\{(baseUri|cspSource|nonce)\}\}/g, (_, key) => escape(values[key]));
}
module.exports = { validateManifest, loadAssets, renderHtml };
