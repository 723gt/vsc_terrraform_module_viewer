'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadModule, usageSnippet } = require('./moduleModel');

/** @type {Map<string, ModulePanel>} ディレクトリ → パネル */
const panels = new Map();

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('terraformModuleViewer.open', (uri) => {
      const dir = resolveModuleDir(uri);
      if (!dir) {
        vscode.window.showWarningMessage('Terraform のモジュールディレクトリか .tf ファイルを選択してください。');
        return;
      }
      ModulePanel.show(context, dir);
    })
  );
}

function deactivate() {
  for (const p of panels.values()) p.dispose();
}

function resolveModuleDir(uri) {
  if (!uri && vscode.window.activeTextEditor) uri = vscode.window.activeTextEditor.document.uri;
  if (!uri || uri.scheme !== 'file') return undefined;
  const p = uri.fsPath;
  try {
    return fs.statSync(p).isDirectory() ? p : path.dirname(p);
  } catch (e) {
    return undefined;
  }
}

class ModulePanel {
  static show(context, dir) {
    const key = path.resolve(dir).toLowerCase();
    const existing = panels.get(key);
    if (existing) {
      existing.panel.reveal();
      existing.refresh();
      return;
    }
    panels.set(key, new ModulePanel(context, dir, key));
  }

  constructor(context, dir, key) {
    this.context = context;
    this.dir = dir;
    this.key = key;
    this.disposables = [];
    this.refreshTimer = undefined;

    const mediaRoot = vscode.Uri.file(path.join(context.extensionPath, 'media'));
    this.panel = vscode.window.createWebviewPanel(
      'terraformModuleViewer',
      'TF: ' + path.basename(dir),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [mediaRoot] }
    );
    this.panel.iconPath = new vscode.ThemeIcon('symbol-structure');
    this.panel.webview.html = this.html(mediaRoot);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);

    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dir), '*.tf'));
    const onFsChange = () => {
      if (vscode.workspace.getConfiguration('terraformModuleViewer').get('autoRefresh', true)) this.scheduleRefresh();
    };
    watcher.onDidChange(onFsChange, null, this.disposables);
    watcher.onDidCreate(onFsChange, null, this.disposables);
    watcher.onDidDelete(onFsChange, null, this.disposables);
    this.disposables.push(watcher);
  }

  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), 300);
  }

  refresh() {
    let model;
    try {
      model = loadModule(this.dir);
    } catch (e) {
      model = { dir: this.dir, name: path.basename(this.dir), fatal: String(e.message || e) };
    }
    this.model = model;
    this.panel.webview.postMessage({ type: 'model', model });
  }

  async onMessage(msg) {
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        this.refresh();
        break;
      case 'open': {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(this.dir, msg.file)));
        const line = Math.max(0, (msg.line || 1) - 1);
        const range = new vscode.Range(line, 0, line, 0);
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, selection: range });
        break;
      }
      case 'openModule':
        if (msg.path && fs.existsSync(msg.path)) ModulePanel.show(this.context, msg.path);
        else vscode.window.showWarningMessage('モジュールのディレクトリが見つかりません: ' + msg.path);
        break;
      case 'copyUsage': {
        if (!this.model || this.model.fatal) return;
        await vscode.env.clipboard.writeText(usageSnippet(this.model, this.sourcePath()));
        vscode.window.showInformationMessage('module ブロックの使用例をクリップボードにコピーしました。');
        break;
      }
    }
  }

  /** ワークスペースルートからの相対パスを module の source 形式で返す */
  sourcePath() {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(this.dir));
    if (!folder) return this.dir.replace(/\\/g, '/');
    const rel = path.relative(folder.uri.fsPath, this.dir).replace(/\\/g, '/');
    return './' + rel;
  }

  html(mediaRoot) {
    const webview = this.panel.webview;
    const nonce = crypto.randomBytes(16).toString('base64');
    const asset = (name) => webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, name));
    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('viewer.css')}">
<title>Terraform Module Viewer</title>
</head>
<body>
<div id="app"><p class="muted">読み込み中…</p></div>
<script nonce="${nonce}" src="${asset('viewer.js')}"></script>
</body>
</html>`;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    panels.delete(this.key);
    clearTimeout(this.refreshTimer);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.panel.dispose();
  }
}

module.exports = { activate, deactivate };
