'use strict';
(() => {
  const vscode = acquireVsCodeApi();
  let restoredDraft = vscode.getState();
  const $ = id => document.getElementById(id);
  let model, version, selected, entries = [], dirtyInput = false, pending = false, latest;
  const send = message => vscode.postMessage({ protocolVersion: 1, ...message });
  const status = text => { $('status').textContent = text; };
  function collect(value, path = [], owner = '页面', mode = '') {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value)) owner = value.label || value.name || owner;
    for (const [key, child] of Object.entries(value)) {
      if (['datasource', 'ctrls'].includes(key)) continue;
      const next = [...path, Array.isArray(value) ? Number(key) : key];
      const nextMode = key === 'fields' ? 'field' : ['pageEvents','serviceEvents'].includes(key) ? 'event' : mode;
      if (child !== null && typeof child !== 'object' && nextMode &&
          !['id','guid','fieldId'].includes(key) && (nextMode !== 'event' || typeof child === 'string')) {
        entries.push({path: next, value: child, title: owner + ' · ' + key, mode: nextMode});
      } else collect(child, next, owner, nextMode);
    }
  }
  function renderTree() {
    const query = $('filter').value.toLowerCase();
    $('tree').replaceChildren();
    for (const entry of entries) {
      if (!(entry.title + ' ' + entry.path.join('/')).toLowerCase().includes(query)) continue;
      const button = document.createElement('button');
      button.className = 'item';
      button.textContent = (entry.mode === 'event' ? '事件 ' : '字段 ') + entry.title;
      button.title = '/' + entry.path.join('/');
      button.addEventListener('click', () => {
        if (dirtyInput || pending) { status('请先应用当前输入或点击“放弃输入并刷新”。'); return; }
        select(entry);
      });
      $('tree').append(button);
    }
  }
  function select(entry) {
    selected = entry;
    $('title').textContent = entry.title;
    $('location').textContent = '/' + entry.path.join('/');
    $('value-label').textContent = entry.mode === 'event' ? (entry.path.includes('serviceEvents') ? '服务事件脚本（仅编辑）' : '前端事件脚本（仅编辑）') : '属性值 · ' + typeof entry.value;
    $('value').disabled = false;
    $('value').value = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
    $('apply').disabled = true;
    $('discard').disabled = true;
  }
  function render(message) {
    latest = message;
    if (dirtyInput || pending) {
      status('文档已更新；当前输入已保留。请应用，或放弃输入并刷新。');
      return;
    }
    if (message.type === 'documentError') {
      model = null; selected = null; entries = []; renderTree();
      $('value').disabled = true; $('apply').disabled = true;
      status(message.error); return;
    }
    model = message.data; version = message.version;
    const oldPath = selected && JSON.stringify(selected.path);
    selected = null; entries = [];
    collect(model);
    $('page').textContent = model.pageId;
    renderTree();
    const same = entries.find(entry => JSON.stringify(entry.path) === oldPath);
    if (same) select(same);
    else { $('value').disabled = true; $('value').value = ''; $('apply').disabled = true; }
    status(message.dirty ? '文档有未保存修改' : '已读取本地页面');
    if (restoredDraft) {
      const draft = restoredDraft;
      restoredDraft = null;
      const entry = entries.find(item => JSON.stringify(item.path) === JSON.stringify(draft.path));
      if (entry && typeof draft.value === 'string' && Number.isInteger(draft.version)) {
        select(entry);
        $('value').value = draft.value;
        version = draft.version;
        dirtyInput = true;
        $('apply').disabled = false;
        $('discard').disabled = false;
        status('已恢复未应用的输入；若文档已变化，请先放弃输入并刷新。');
      } else {
        // Keep the draft visible even when its original property was removed.
        $('value').value = typeof draft.value === 'string' ? draft.value : '';
        $('value').disabled = false;
        dirtyInput = true;
        $('discard').disabled = false;
        status('草稿对应属性已不存在，请先复制输入，再放弃输入并刷新。');
      }
    }
  }
  $('filter').addEventListener('input', renderTree);
  $('value').addEventListener('input', () => {
    dirtyInput = true; $('apply').disabled = pending; $('discard').disabled = pending;
    if (selected) vscode.setState({path: selected.path, value: $('value').value, version});
    status('输入尚未应用到文档，请点击“应用到文档”后保存。');
  });
  $('discard').addEventListener('click', () => {
    dirtyInput = false;
    vscode.setState(null);
    if (latest) render(latest);
    $('discard').disabled = true;
  });
  $('apply').addEventListener('click', () => {
    if (!selected || !model || pending) return;
    try {
      const value = typeof selected.value === 'string' ? $('value').value : JSON.parse($('value').value);
      if (typeof value !== typeof selected.value || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('请保持属性值类型不变。');
      pending = true; $('value').disabled = true; $('apply').disabled = true; $('discard').disabled = true;
      send({ type: 'edit', version, path: selected.path, value, requestId: String(Date.now()) });
    } catch (error) { status(error.message); }
  });
  window.addEventListener('message', event => {
    const message = event.data;
    if (message?.protocolVersion !== 1) return;
    if (message.type === 'document' || message.type === 'documentError') render(message);
    else if (message.type === 'applied') {
      pending = false; dirtyInput = false;
      vscode.setState(null);
      if (latest) render(latest);
      status('已应用到文档，请按 Ctrl / ⌘ + S 保存。');
    } else if (message.type === 'editError') {
      pending = false; $('value').disabled = false; $('apply').disabled = false; $('discard').disabled = false;
      status(message.error);
    }
  });
  send({ type: 'ready' });
})();
