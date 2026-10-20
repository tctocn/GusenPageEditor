'use strict';
const vscode = require('vscode');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspect, createEdit } = require('./document');
const { loadAssets, renderHtml } = require('./assets');

function activate(context) {
  const provider = {
    async resolveCustomTextEditor(document, panel) {
      if (!vscode.workspace.isTrusted) throw new Error('请先信任此工作区，再使用谷神编辑器。');
      if (vscode.workspace.getConfiguration('gushen', document.uri).get('editorMode', 'platform') === 'platform') {
        return require('./native-provider').resolveNativeEditor(context, document, panel);
      }
      const configured = vscode.workspace.getConfiguration('gushen', document.uri).get('designerAssetsPath', '');
      if (configured && !path.isAbsolute(configured)) throw new Error('设计器资源路径需要使用绝对路径。');
      const assets = await loadAssets(configured || path.join(context.extensionPath, 'designer-assets'));
      panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.file(assets.root)] };
      const post = message => panel.webview.postMessage({ protocolVersion: 1, ...message });
      const sync = () => {
        try {
          const { data } = inspect(document.getText());
          return post({ type: 'document', data, version: document.version, dirty: document.isDirty });
        } catch (error) {
          return post({ type: 'documentError', error: error.message, version: document.version });
        }
      };
      let applying = false;
      const messages = panel.webview.onDidReceiveMessage(async message => {
        if (!message || message.protocolVersion !== 1) return;
        if (message.type === 'ready') { await sync(); return; }
        if (message.type !== 'edit') return;
        if (applying) {
          await post({ type: 'editError', requestId: message.requestId, error: '上一项修改正在应用，请刷新后重试。' });
          return;
        }
        try {
          if (message.version !== document.version) throw new Error('文档已变化，请先刷新，避免覆盖其他修改。');
          if (document.isClosed) throw new Error('文档已关闭。');
          const edit = createEdit(document.getText(), message.path, message.value);
          const change = new vscode.WorkspaceEdit();
          change.replace(document.uri, new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text);
          applying = true;
          if (!await vscode.workspace.applyEdit(change)) throw new Error('修改未能应用到文档。');
          await sync();
          await post({ type: 'applied', requestId: message.requestId });
        } catch (error) {
          await post({ type: 'editError', requestId: message.requestId, error: error.message });
        } finally { applying = false; }
      });
      const changes = vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.uri.toString() === document.uri.toString()) void sync();
      });
      const saves = vscode.workspace.onDidSaveTextDocument(saved => {
        if (saved.uri.toString() === document.uri.toString()) void sync();
      });
      panel.onDidDispose(() => { messages.dispose(); changes.dispose(); saves.dispose(); });
      panel.webview.html = renderHtml(assets.html, {
        baseUri: panel.webview.asWebviewUri(vscode.Uri.file(path.dirname(assets.entry) + path.sep)).toString(),
        cspSource: panel.webview.cspSource,
        nonce: crypto.randomBytes(24).toString('hex')
      });
    }
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider('gushen.pageEditor', provider, {
    supportsMultipleEditorsPerDocument: true, webviewOptions: { retainContextWhenHidden: true }
  }));
}
module.exports = { activate, deactivate() {} };
