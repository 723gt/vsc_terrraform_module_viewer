// @ts-check
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const saved = vscode.getState() || {};
  const state = {
    model: null,
    query: saved.query || '',
    open: new Set(saved.open || []),
    collapsed: new Set(saved.collapsed || []),
  };

  function persist() {
    vscode.setState({ query: state.query, open: [...state.open], collapsed: [...state.collapsed] });
  }

  // ---------- 小物 ----------

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const TOKEN_RE = /("(?:[^"\\\n]|\\.)*")|(#[^\n]*|\/\/[^\n]*)|\b((?:var|local|module|data|each|count|path|self)\.[A-Za-z0-9_.\-\[\]"*]+)|\b(true|false|null)\b|\b(\d+(?:\.\d+)?)\b|\b([a-z_][a-z0-9_]*)(?=\()/g;

  /** HCL 式の簡易シンタックスハイライト */
  function hl(raw) {
    if (raw == null) return '';
    let out = '';
    let last = 0;
    String(raw).replace(TOKEN_RE, (m, str, cmt, ref, kw, num, fn, offset) => {
      out += esc(raw.slice(last, offset));
      const cls = str ? 'str' : cmt ? 'cmt' : ref ? 'ref' : kw ? 'kw' : num ? 'num' : 'fn';
      out += '<span class="t-' + cls + '">' + esc(m) + '</span>';
      last = offset + m.length;
      return m;
    });
    return out + esc(String(raw).slice(last));
  }

  /** 2 行目以降の共通インデントを取り除く（1 行目は "=" の直後から始まるため対象外） */
  function dedent(raw) {
    const lines = String(raw).split('\n');
    if (lines.length < 2) return raw;
    const rest = lines.slice(1).filter((l) => l.trim());
    const min = Math.min.apply(null, rest.map((l) => /^[ \t]*/.exec(l)[0].length));
    return [lines[0]].concat(lines.slice(1).map((l) => l.slice(Math.min(min, /^[ \t]*/.exec(l)[0].length)))).join('\n');
  }

  function code(raw, cls) {
    if (raw == null || raw === '') return '<span class="muted">—</span>';
    raw = dedent(raw);
    const multi = String(raw).indexOf('\n') !== -1;
    return multi
      ? '<pre class="code ' + (cls || '') + '">' + hl(raw) + '</pre>'
      : '<code class="code ' + (cls || '') + '">' + hl(raw) + '</code>';
  }

  function locLink(item) {
    return '<a class="loc" data-file="' + esc(item.file) + '" data-line="' + item.line + '" title="定義へ移動">' +
      esc(item.file) + ':' + item.line + '</a>';
  }

  function jump(item, inner) {
    return '<a class="jump" data-file="' + esc(item.file) + '" data-line="' + item.line + '">' + inner + '</a>';
  }

  function badge(text, kind) {
    return '<span class="badge ' + (kind || '') + '">' + esc(text) + '</span>';
  }

  function desc(s) {
    if (!s) return '<span class="muted">—</span>';
    return '<div class="desc">' + esc(s).replace(/\n/g, '<br>') + '</div>';
  }

  /** 検索語にマッチするか（スペース区切りで AND） */
  function matches() {
    const q = state.query.trim().toLowerCase();
    if (!q) return () => true;
    const terms = q.split(/\s+/);
    return function () {
      const hay = Array.prototype.join.call(arguments, '\u0000').toLowerCase();
      return terms.every((t) => hay.indexOf(t) !== -1);
    };
  }

  // ---------- セクション ----------

  function section(id, title, count, body, extra) {
    const collapsed = state.collapsed.has(id);
    return '<section id="sec-' + id + '" class="' + (collapsed ? 'collapsed' : '') + '">' +
      '<h2 data-toggle-section="' + id + '"><span class="chev"></span>' + esc(title) +
      ' <span class="count">' + count + '</span>' + (extra || '') + '</h2>' +
      '<div class="sec-body">' + body + '</div></section>';
  }

  function table(headers, rows) {
    return '<table><thead><tr>' + headers.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
      rows.join('') + '</tbody></table>';
  }

  function attrTable(attrs, file) {
    if (!attrs.length) return '';
    return '<table class="attrs"><tbody>' + attrs.map((a) =>
      '<tr><td class="aname">' + jump({ file: file, line: a.line }, esc(a.name)) + '</td><td>' + code(a.value) + '</td></tr>'
    ).join('') + '</tbody></table>';
  }

  function blockTree(blocks, file) {
    if (!blocks || !blocks.length) return '';
    return '<ul class="tree">' + blocks.map((b) =>
      '<li><div class="bhead">' + jump({ file: file, line: b.line }, esc(b.type)) +
      b.labels.map((l) => ' <span class="t-str">"' + esc(l) + '"</span>').join('') + ' <span class="muted">{ }</span></div>' +
      attrTable(b.attributes, file) + blockTree(b.blocks, file) + '</li>'
    ).join('') + '</ul>';
  }

  function renderTerraform(m) {
    const t = m.terraform;
    if (!t.requiredVersion && !t.requiredProviders.length && !t.backend) return '';
    let body = '<dl class="kv">';
    body += '<dt>required_version</dt><dd>' + (t.requiredVersion ? '<code class="code">' + esc(t.requiredVersion) + '</code>' : '<span class="muted">未指定</span>') + '</dd>';
    if (t.backend) {
      body += '<dt>backend</dt><dd>' + jump(t.backend, badge(t.backend.type, 'info')) + '</dd>';
    }
    body += '</dl>';
    if (t.requiredProviders.length) {
      body += '<h3>required_providers</h3>' + table(['名前', 'source', 'version', '定義'], t.requiredProviders.map((p) =>
        '<tr><td>' + jump(p, '<b>' + esc(p.name) + '</b>') + '</td><td>' + (p.source ? '<code class="code">' + esc(p.source) + '</code>' : p.version ? '<span class="muted">（省略）</span>' : code(p.raw)) +
        '</td><td>' + (p.version ? '<code class="code">' + esc(p.version) + '</code>' : '<span class="muted">—</span>') + '</td><td>' + locLink(p) + '</td></tr>'
      ));
    }
    return section('terraform', 'Terraform 設定', t.requiredProviders.length, body);
  }

  function renderVariables(m, match) {
    const items = m.variables.filter((v) => match(v.name, v.description, v.type, v.default));
    if (!items.length) return m.scope || (m.variables.length && state.query) ? '' : section('variables', 'Variables（入力変数）', 0, '<p class="muted">なし</p>');
    const required = items.filter((v) => !v.hasDefault).length;
    const rows = items.map((v) => {
      const flags = [];
      flags.push(v.hasDefault ? badge('optional', 'dim') : badge('required', 'warn'));
      if (v.sensitive) flags.push(badge('sensitive', 'danger'));
      if (v.nullable === 'false') flags.push(badge('non-null', 'dim'));
      if (v.validations.length) flags.push(badge('validation ×' + v.validations.length, 'info'));
      if (v.refs === 0) flags.push(badge('未使用', 'danger'));
      const validations = v.validations.length
        ? '<details class="sub"><summary>validation</summary>' + v.validations.map((x) =>
          '<div class="validation">' + code(x.condition) + (x.errorMessage ? '<div class="muted">' + esc(x.errorMessage) + '</div>' : '') + '</div>'
        ).join('') + '</details>'
        : '';
      return '<tr><td>' + jump(v, '<b>' + esc(v.name) + '</b>') + '<div class="flags">' + flags.join('') + '</div></td>' +
        '<td>' + code(v.type || 'any', 'type') + '</td>' +
        '<td>' + (v.hasDefault ? code(v.default) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + desc(v.description) + validations + '</td>' +
        '<td>' + locLink(v) + '</td></tr>';
    });
    return section('variables', 'Variables（入力変数）', items.length,
      table(['名前', 'type', 'default', 'description', '定義'], rows),
      ' <span class="sub-count">必須 ' + required + ' / 任意 ' + (items.length - required) + '</span>');
  }

  function renderOutputs(m, match) {
    const items = m.outputs.filter((o) => match(o.name, o.description, o.value));
    if (!items.length) return m.scope || (m.outputs.length && state.query) ? '' : section('outputs', 'Outputs（出力）', 0, '<p class="muted">なし</p>');
    const rows = items.map((o) =>
      '<tr><td>' + jump(o, '<b>' + esc(o.name) + '</b>') + (o.sensitive ? '<div class="flags">' + badge('sensitive', 'danger') + '</div>' : '') + '</td>' +
      '<td>' + code(o.value) + '</td><td>' + desc(o.description) + '</td><td>' + locLink(o) + '</td></tr>'
    );
    return section('outputs', 'Outputs（出力）', items.length, table(['名前', 'value', 'description', '定義'], rows));
  }

  function renderResourceList(id, title, list, prefix, match) {
    const items = list.filter((r) => match(r.resourceType, r.name, r.attributes.map((a) => a.name + '=' + a.value).join(' ')));
    if (!items.length) return '';
    // type ごとにグループ化
    const groups = new Map();
    for (const r of items) {
      if (!groups.has(r.resourceType)) groups.set(r.resourceType, []);
      groups.get(r.resourceType).push(r);
    }
    let body = '';
    for (const [type, rs] of groups) {
      body += '<div class="rgroup"><div class="rtype"><span class="prov">' + esc(rs[0].provider) + '</span> ' + esc(type) +
        ' <span class="count">' + rs.length + '</span></div>';
      for (const r of rs) {
        const key = id + ':' + r.resourceType + '.' + r.name;
        const meta = Object.keys(r.meta).map((k) => badge(k + ': ' + r.meta[k].replace(/\s+/g, ' ').slice(0, 60), k === 'depends_on' ? 'dim' : 'info')).join('');
        body += '<details class="res" data-key="' + esc(key) + '"' + (state.open.has(key) ? ' open' : '') + '>' +
          '<summary><span class="rname">' + esc(prefix + r.resourceType + '.') + '<b>' + esc(r.name) + '</b></span>' + meta +
          (r.lifecycle ? badge('lifecycle', 'dim') : '') + '<span class="spacer"></span>' + locLink(r) + '</summary>' +
          '<div class="res-body">' + (attrTable(r.attributes, r.file) || '') + blockTree(r.blocks, r.file) +
          (r.lifecycle ? blockTree([r.lifecycle], r.file) : '') +
          (!r.attributes.length && !r.blocks.length ? '<p class="muted">属性なし</p>' : '') + '</div></details>';
      }
      body += '</div>';
    }
    return section(id, title, items.length, body);
  }

  function renderModules(m, match) {
    const items = m.modules.filter((x) => match(x.name, x.source, x.inputs.map((a) => a.name).join(' ')));
    if (!items.length) return '';
    let body = '';
    for (const x of items) {
      const key = 'module:' + x.name;
      const src = x.localPath
        ? '<a class="modlink" data-path="' + esc(x.localPath) + '" title="このモジュールをビューアで開く">' + esc(x.source) + ' ↗</a>'
        : '<code class="code">' + esc(x.source || '?') + '</code>';
      const meta = Object.keys(x.meta).map((k) => badge(k + ': ' + x.meta[k].replace(/\s+/g, ' ').slice(0, 60), 'info')).join('');
      body += '<details class="res" data-key="' + esc(key) + '"' + (state.open.has(key) ? ' open' : '') + '>' +
        '<summary><span class="rname">module.<b>' + esc(x.name) + '</b></span>' + src +
        (x.version ? badge('v ' + x.version, 'dim') : '') + meta + badge('入力 ' + x.inputs.length, 'dim') +
        '<span class="spacer"></span>' + locLink(x) + '</summary>' +
        '<div class="res-body">' + (attrTable(x.inputs, x.file) || '<p class="muted">入力なし</p>') + '</div></details>';
    }
    return section('modules', 'Modules（子モジュール呼び出し）', items.length, body);
  }

  function renderLocals(m, match) {
    const items = m.locals.filter((l) => match(l.name, l.value));
    if (!items.length) return '';
    const rows = items.map((l) =>
      '<tr><td>' + jump(l, '<b>' + esc(l.name) + '</b>') + (l.refs === 0 ? '<div class="flags">' + badge('未使用', 'danger') + '</div>' : '') +
      '</td><td>' + code(l.value) + '</td><td>' + locLink(l) + '</td></tr>'
    );
    return section('locals', 'Locals', items.length, table(['名前', '値', '定義'], rows));
  }

  function renderProviders(m, match) {
    const items = m.providers.filter((p) => match(p.name, p.alias));
    if (!items.length) return '';
    let body = '';
    for (const p of items) {
      body += '<div class="card"><div class="bhead">' + jump(p, '<b>' + esc(p.name) + '</b>') +
        (p.alias ? ' ' + badge('alias: ' + p.alias, 'info') : '') + '<span class="spacer"></span>' + locLink(p) + '</div>' +
        attrTable(p.attributes, p.file) + blockTree(p.blocks, p.file) + '</div>';
    }
    return section('providers', 'Providers', items.length, body);
  }

  function renderOthers(m, match) {
    const items = m.others.filter((o) => match(o.type, o.labels.join(' ')));
    if (!items.length) return '';
    let body = '';
    for (const o of items) {
      body += '<div class="card"><div class="bhead">' + jump(o, '<b>' + esc(o.type) + '</b>') +
        o.labels.map((l) => ' <span class="t-str">"' + esc(l) + '"</span>').join('') + '<span class="spacer"></span>' + locLink(o) + '</div>' +
        attrTable(o.attributes, o.file) + blockTree(o.blocks, o.file) + '</div>';
    }
    return section('others', 'その他のブロック', items.length, body);
  }

  function renderFiles(m) {
    if (m.scope) return '';
    const rows = m.files.map((f) =>
      '<tr><td>' + jump({ file: f.file, line: 1 }, esc(f.file)) + '</td><td class="num">' + f.lines + '</td><td>' +
      Object.keys(f.blocks).map((k) => badge(k + ' ×' + f.blocks[k], 'dim')).join('') + '</td>' +
      '<td><a class="action" data-open-file="' + esc(f.file) + '">単体で表示</a></td></tr>'
    );
    return section('files', 'ファイル', m.files.length, table(['ファイル', '行数', 'ブロック', ''], rows));
  }

  const KIND_LABEL = { var: 'var', local: 'local', module: 'module', data: 'data', resource: 'resource' };

  function refName(r) {
    return (r.kind === 'resource' ? '' : r.kind + '.') + r.name;
  }

  /** ファイル単体表示: このファイルが参照しているもの */
  function renderReferences(m, match) {
    if (!m.scope) return '';
    const items = m.references.filter((r) => match(refName(r), r.def ? r.def.file : ''));
    if (!items.length) return '';
    const external = items.filter((r) => r.def && r.def.file !== m.scope.file).length;
    const missing = items.filter((r) => !r.def).length;
    const rows = items.map((r) => {
      let where;
      if (!r.def) where = badge(r.kind === 'var' || r.kind === 'local' || r.kind === 'module' ? '定義なし' : '不明', 'danger');
      else if (r.def.file === m.scope.file) where = locLink(r.def) + ' ' + badge('同じファイル', 'dim');
      else where = locLink(r.def);
      return '<tr><td>' + badge(KIND_LABEL[r.kind], 'dim') + '</td><td>' +
        (r.def ? jump(r.def, '<code class="code">' + hl(refName(r)) + '</code>') : '<code class="code">' + hl(refName(r)) + '</code>') +
        '</td><td class="num">' + r.count + '</td><td>' + where + '</td></tr>';
    });
    const extra = ' <span class="sub-count">他ファイル ' + external + (missing ? ' / 定義なし ' + missing : '') + '</span>';
    return section('references', 'このファイルが参照しているもの', items.length,
      table(['種類', '参照', '回数', '定義場所'], rows), extra);
  }

  /** ファイル単体表示: このファイルの定義を参照している他ファイル */
  function renderReferencedBy(m, match) {
    if (!m.scope) return '';
    const items = m.referencedBy.filter((r) => match(refName(r), r.file));
    if (!items.length) return section('referencedBy', '他のファイルからの参照', 0, '<p class="muted">このファイルの定義は他のファイルから参照されていません</p>');
    const rows = items.map((r) =>
      '<tr><td>' + badge(KIND_LABEL[r.kind], 'dim') + '</td><td><code class="code">' + hl(refName(r)) + '</code></td>' +
      '<td>' + locLink(r) + '</td><td class="num">' + r.count + '</td></tr>'
    );
    return section('referencedBy', '他のファイルからの参照', items.length, table(['種類', '定義', '参照元', '回数'], rows));
  }

  function summaryChips(m) {
    const chips = [
      ['variables', 'Variables', m.variables.length],
      ['outputs', 'Outputs', m.outputs.length],
      ['resources', 'Resources', m.resources.length],
      ['data', 'Data', m.dataSources.length],
      ['modules', 'Modules', m.modules.length],
      ['locals', 'Locals', m.locals.length],
      ['providers', 'Providers', m.providers.length],
    ];
    if (m.scope) {
      // ファイル単体表示では 0 件の項目を省き、参照の 2 セクションへのリンクを足す
      for (let i = chips.length - 1; i >= 0; i--) if (!chips[i][2]) chips.splice(i, 1);
      chips.push(['references', '参照', m.references.length], ['referencedBy', '他ファイルから', m.referencedBy.length]);
    }
    return '<nav class="chips">' + chips.map((c) =>
      '<a class="chip' + (c[2] ? '' : ' zero') + '" data-scroll="' + c[0] + '"><span class="n">' + c[2] + '</span>' + c[1] + '</a>'
    ).join('') + '</nav>';
  }

  // ---------- 描画 ----------

  function render() {
    const m = state.model;
    if (!m) return;
    if (m.fatal) {
      app.innerHTML = '<div class="error">読み込みに失敗しました: ' + esc(m.fatal) + '</div>';
      return;
    }
    const match = matches();
    const fileMode = !!m.scope;
    const title = fileMode
      ? '<h1>' + jump({ file: m.scope.file, line: 1 }, esc(m.scope.file)) + ' ' + badge('ファイル単体', 'info') + '</h1>' +
        '<div class="path muted">モジュール: ' + esc(m.name) + ' — ' + esc(m.dir) + '</div>'
      : '<h1>' + esc(m.name) + '</h1><div class="path muted">' + esc(m.dir) + '</div>';
    const mainButton = fileMode
      ? '<button id="btn-folder" title="このファイルがあるフォルダ全体をビューアで開く">フォルダ全体を表示</button>'
      : '<button id="btn-usage" title="このモジュールを呼び出す module ブロックをコピー">使用例をコピー</button>';
    const header =
      '<header><div class="title">' + title + '</div>' +
      '<div class="actions"><input id="search" type="search" placeholder="フィルタ（名前・説明・値）" value="' + esc(state.query) + '">' +
      mainButton +
      '<button id="btn-expand" class="secondary" title="すべて展開/折りたたみ">展開</button>' +
      '<button id="btn-refresh" class="secondary" title="再読み込み">⟳</button></div></header>';

    let html = header + summaryChips(m);
    if (!m.files.length && !fileMode) html += '<div class="error">このディレクトリに .tf ファイルがありません。</div>';
    for (const e of m.errors) html += '<div class="error">' + esc(e.file) + ': ' + esc(e.message) + '</div>';
    html += renderTerraform(m) + renderVariables(m, match) + renderOutputs(m, match) +
      renderResourceList('resources', 'Resources（リソース）', m.resources, '', match) +
      renderResourceList('data', 'Data Sources', m.dataSources, 'data.', match) +
      renderModules(m, match) + renderLocals(m, match) + renderProviders(m, match) + renderOthers(m, match) +
      renderReferences(m, match) + renderReferencedBy(m, match) + renderFiles(m);

    const scrollY = window.scrollY;
    const hadFocus = document.activeElement && document.activeElement.id === 'search';
    const sel = hadFocus ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    app.innerHTML = html;
    window.scrollTo(0, scrollY);
    if (hadFocus) {
      const s = document.getElementById('search');
      s.focus();
      s.setSelectionRange(sel[0], sel[1]);
    }
  }

  // ---------- イベント ----------

  app.addEventListener('click', (ev) => {
    const target = /** @type {HTMLElement} */ (ev.target);
    const link = target.closest('[data-file]');
    if (link) {
      ev.preventDefault();
      ev.stopPropagation();
      vscode.postMessage({ type: 'open', file: link.getAttribute('data-file'), line: Number(link.getAttribute('data-line')) });
      return;
    }
    const fileLink = target.closest('[data-open-file]');
    if (fileLink) {
      vscode.postMessage({ type: 'openFile', file: fileLink.getAttribute('data-open-file') });
      return;
    }
    const mod = target.closest('[data-path]');
    if (mod) {
      ev.preventDefault();
      ev.stopPropagation();
      vscode.postMessage({ type: 'openModule', path: mod.getAttribute('data-path') });
      return;
    }
    const sec = target.closest('[data-toggle-section]');
    if (sec) {
      const id = sec.getAttribute('data-toggle-section');
      if (state.collapsed.has(id)) state.collapsed.delete(id);
      else state.collapsed.add(id);
      sec.parentElement.classList.toggle('collapsed');
      persist();
      return;
    }
    const chip = target.closest('[data-scroll]');
    if (chip) {
      const el = document.getElementById('sec-' + chip.getAttribute('data-scroll'));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (target.id === 'btn-refresh') vscode.postMessage({ type: 'refresh' });
    if (target.id === 'btn-usage') vscode.postMessage({ type: 'copyUsage' });
    if (target.id === 'btn-folder') vscode.postMessage({ type: 'openFolder' });
    if (target.id === 'btn-expand') {
      const all = Array.from(document.querySelectorAll('details.res'));
      const open = all.some((d) => !d.open);
      for (const d of all) {
        d.open = open;
        const key = d.getAttribute('data-key');
        if (open) state.open.add(key);
        else state.open.delete(key);
      }
      persist();
    }
  });

  // details の開閉状態を覚えておく（再描画しても維持）
  app.addEventListener('toggle', (ev) => {
    const d = /** @type {HTMLDetailsElement} */ (ev.target);
    const key = d.getAttribute && d.getAttribute('data-key');
    if (!key) return;
    if (d.open) state.open.add(key);
    else state.open.delete(key);
    persist();
  }, true);

  let searchTimer;
  app.addEventListener('input', (ev) => {
    const target = /** @type {HTMLInputElement} */ (ev.target);
    if (target.id !== 'search') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = target.value;
      persist();
      render();
    }, 120);
  });

  window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'model') {
      state.model = ev.data.model;
      render();
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
