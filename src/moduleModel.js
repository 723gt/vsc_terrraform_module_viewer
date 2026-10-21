'use strict';

const fs = require('fs');
const path = require('path');
const { parseHcl, stringValue, getAttr } = require('./hclParser');

const META_ARGS = ['count', 'for_each', 'provider', 'depends_on'];

function attrValue(block, name) {
  const a = getAttr(block, name);
  return a ? a.value : undefined;
}

function attrString(block, name) {
  const a = getAttr(block, name);
  return a ? stringValue(a.value) : undefined;
}

function loc(file, node) {
  return { file, line: node.line, endLine: node.endLine };
}

/** ネストブロックをツリー表示用に簡略化する */
function summarizeBlock(b) {
  return {
    type: b.type,
    labels: b.labels,
    line: b.line,
    attributes: b.attributes.map((a) => ({ name: a.name, value: a.value, line: a.line })),
    blocks: b.blocks.map(summarizeBlock),
  };
}

/** `{ source = "...", version = "..." }` 形式の object 式から簡易的に値を取り出す */
function objectField(raw, key) {
  if (!raw) return undefined;
  const m = new RegExp('\\b' + key + '\\s*=\\s*"([^"]*)"').exec(raw);
  return m ? m[1] : undefined;
}

function countRefs(texts, prefix, name) {
  const re = new RegExp('\\b' + prefix + '\\.' + name.replace(/[-]/g, '\\-') + '\\b', 'g');
  let n = 0;
  for (const t of texts) {
    const m = t.match(re);
    if (m) n += m.length;
  }
  return n;
}

/**
 * ディレクトリ内の *.tf を読み込み、モジュールの構造をまとめたモデルを返す。
 * options.file を指定すると、そのファイルに定義されたブロックだけに絞ったモデルを返す
 * （参照数や参照先の解決にはディレクトリ全体を使う）。
 */
function loadModule(dir, options) {
  const file = options && options.file;
  if (!file) return loadDirectory(dir).model;

  const full = loadDirectory(dir);
  const all = full.model;
  const inFile = (x) => x.file === file;
  const t = all.terraform;
  const model = Object.assign({}, all, {
    scope: { file },
    files: all.files.filter(inFile),
    errors: all.errors.filter(inFile),
    terraform: {
      requiredVersion: t.requiredVersionFile === file ? t.requiredVersion : undefined,
      requiredProviders: t.requiredProviders.filter(inFile),
      backend: t.backend && inFile(t.backend) ? t.backend : undefined,
    },
    variables: all.variables.filter(inFile),
    outputs: all.outputs.filter(inFile),
    resources: all.resources.filter(inFile),
    dataSources: all.dataSources.filter(inFile),
    modules: all.modules.filter(inFile),
    locals: all.locals.filter(inFile),
    providers: all.providers.filter(inFile),
    others: all.others.filter(inFile),
  });
  if (!all.files.some(inFile) && !model.errors.length) {
    model.errors.push({ file, message: 'ファイルが見つかりません' });
  }
  model.references = full.texts[file] != null ? collectReferences(full.texts[file], all) : [];
  model.referencedBy = collectReferencedBy(model, full.texts, file);
  return model;
}

const REF_KINDS = [
  // [kind, 正規表現, 定義の探し方]
  ['var', /\bvar\.([A-Za-z_][\w-]*)/g, (m, all) => all.variables.find((x) => x.name === m[1])],
  ['local', /\blocal\.([A-Za-z_][\w-]*)/g, (m, all) => all.locals.find((x) => x.name === m[1])],
  ['module', /\bmodule\.([A-Za-z_][\w-]*)/g, (m, all) => all.modules.find((x) => x.name === m[1])],
  ['data', /\bdata\.([A-Za-z_][\w-]*)\.([A-Za-z_][\w-]*)/g,
    (m, all) => all.dataSources.find((x) => x.resourceType === m[1] && x.name === m[2])],
];

/** コメントを空白に置き換える（行番号を保つため長さは変えない）。文字列の中の # や // は残す */
function stripComments(text) {
  return text.replace(/("(?:[^"\\\n]|\\.)*")|#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) =>
    str ? m : m.replace(/[^\n]/g, ' '));
}

/**
 * ファイル内の var. / local. / module. / data. / リソース参照を集め、定義位置と結び付ける。
 * 定義が見つからない参照も undefined のまま返す。
 */
function collectReferences(text, all) {
  const src = stripComments(text);
  const refs = new Map();
  const add = (kind, name, def) => {
    const key = kind + ':' + name;
    const r = refs.get(key) || { kind, name, count: 0, def: def ? { file: def.file, line: def.line } : undefined };
    r.count++;
    refs.set(key, r);
  };

  for (const [kind, re, find] of REF_KINDS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) add(kind, m.slice(1).join('.'), find(m, all));
  }

  // リソース参照（aws_s3_bucket.this など）。定義済みの type.name だけを拾う
  const resources = new Map(all.resources.map((r) => [r.resourceType + '.' + r.name, r]));
  const resRe = /\b([A-Za-z][\w-]*)\.([A-Za-z_][\w-]*)/g;
  let m;
  while ((m = resRe.exec(src))) {
    const def = resources.get(m[1] + '.' + m[2]);
    // data.aws_x.y の後半や、resource ブロック自身のラベルは除外
    if (def && src.slice(Math.max(0, m.index - 5), m.index) !== 'data.') add('resource', m[1] + '.' + m[2], def);
  }

  const order = ['var', 'local', 'module', 'data', 'resource'];
  return Array.from(refs.values()).sort((a, b) =>
    order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name));
}

/** このファイルで定義されたものを、他のファイルから参照している箇所の件数 */
function collectReferencedBy(model, texts, file) {
  const targets = []
    .concat(model.variables.map((v) => ({ kind: 'var', name: v.name, re: 'var\\.' + v.name })))
    .concat(model.locals.map((l) => ({ kind: 'local', name: l.name, re: 'local\\.' + l.name })))
    .concat(model.modules.map((x) => ({ kind: 'module', name: x.name, re: 'module\\.' + x.name })))
    .concat(model.dataSources.map((d) => ({ kind: 'data', name: d.resourceType + '.' + d.name, re: 'data\\.' + d.resourceType + '\\.' + d.name })))
    .concat(model.resources.map((r) => ({ kind: 'resource', name: r.resourceType + '.' + r.name, re: '(?<!data\\.)' + r.resourceType + '\\.' + r.name })));
  const result = [];
  for (const other of Object.keys(texts).sort()) {
    if (other === file) continue;
    const src = stripComments(texts[other]);
    for (const t of targets) {
      const re = new RegExp('\\b' + t.re.replace(/-/g, '\\-') + '\\b', 'g');
      const lines = [];
      let m;
      while ((m = re.exec(src))) lines.push(src.slice(0, m.index).split('\n').length);
      if (lines.length) result.push({ kind: t.kind, name: t.name, file: other, line: lines[0], count: lines.length });
    }
  }
  return result;
}

function loadDirectory(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.tf'))
    .sort();

  const model = {
    dir,
    name: path.basename(dir),
    files: [],
    errors: [],
    terraform: { requiredVersion: undefined, requiredProviders: [], backend: undefined },
    variables: [],
    outputs: [],
    resources: [],
    dataSources: [],
    modules: [],
    locals: [],
    providers: [],
    others: [],
  };

  const texts = {};

  for (const file of files) {
    const full = path.join(dir, file);
    let text;
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch (e) {
      model.errors.push({ file, message: String(e.message || e) });
      continue;
    }
    texts[file] = text;

    let body;
    try {
      body = parseHcl(text);
    } catch (e) {
      model.errors.push({ file, message: String(e.message || e) });
      continue;
    }

    const counts = {};
    for (const b of body.blocks) {
      counts[b.type] = (counts[b.type] || 0) + 1;
      collectBlock(model, file, b);
    }
    model.files.push({ file, lines: text.split('\n').length, blocks: counts });
  }

  // 参照数（同一モジュール内での var.x / local.x の出現回数）
  const allTexts = Object.keys(texts).map((f) => texts[f]);
  for (const v of model.variables) v.refs = countRefs(allTexts, 'var', v.name);
  for (const l of model.locals) l.refs = countRefs(allTexts, 'local', l.name);

  return { model, texts };
}

function collectBlock(model, file, b) {
  const label0 = b.labels[0];
  switch (b.type) {
    case 'variable': {
      const def = getAttr(b, 'default');
      model.variables.push(Object.assign(loc(file, b), {
        name: label0,
        type: attrValue(b, 'type'),
        default: def ? def.value : undefined,
        hasDefault: !!def,
        description: attrString(b, 'description'),
        sensitive: attrValue(b, 'sensitive') === 'true',
        nullable: attrValue(b, 'nullable'),
        validations: b.blocks
          .filter((x) => x.type === 'validation')
          .map((x) => ({
            condition: attrValue(x, 'condition'),
            errorMessage: attrString(x, 'error_message'),
            line: x.line,
          })),
      }));
      break;
    }
    case 'output':
      model.outputs.push(Object.assign(loc(file, b), {
        name: label0,
        description: attrString(b, 'description'),
        value: attrValue(b, 'value'),
        sensitive: attrValue(b, 'sensitive') === 'true',
        dependsOn: attrValue(b, 'depends_on'),
      }));
      break;
    case 'resource':
    case 'data': {
      const target = b.type === 'resource' ? model.resources : model.dataSources;
      const meta = {};
      for (const k of META_ARGS) {
        const v = attrValue(b, k);
        if (v !== undefined) meta[k] = v;
      }
      const lifecycle = b.blocks.find((x) => x.type === 'lifecycle');
      target.push(Object.assign(loc(file, b), {
        resourceType: label0,
        name: b.labels[1],
        provider: (label0 || '').split('_')[0],
        meta,
        lifecycle: lifecycle ? summarizeBlock(lifecycle) : undefined,
        attributes: b.attributes
          .filter((a) => META_ARGS.indexOf(a.name) === -1)
          .map((a) => ({ name: a.name, value: a.value, line: a.line })),
        blocks: b.blocks.filter((x) => x.type !== 'lifecycle').map(summarizeBlock),
      }));
      break;
    }
    case 'module': {
      const source = attrString(b, 'source');
      const meta = {};
      for (const k of ['count', 'for_each', 'depends_on', 'providers']) {
        const v = attrValue(b, k);
        if (v !== undefined) meta[k] = v;
      }
      const isLocal = !!source && /^\.\.?[\\/]/.test(source);
      model.modules.push(Object.assign(loc(file, b), {
        name: label0,
        source,
        version: attrString(b, 'version'),
        localPath: isLocal ? path.resolve(model.dir, source) : undefined,
        meta,
        inputs: b.attributes
          .filter((a) => ['source', 'version', 'count', 'for_each', 'depends_on', 'providers'].indexOf(a.name) === -1)
          .map((a) => ({ name: a.name, value: a.value, line: a.line })),
      }));
      break;
    }
    case 'locals':
      for (const a of b.attributes) {
        model.locals.push({ file, line: a.line, endLine: a.endLine, name: a.name, value: a.value });
      }
      break;
    case 'provider':
      model.providers.push(Object.assign(loc(file, b), {
        name: label0,
        alias: attrString(b, 'alias'),
        attributes: b.attributes.map((a) => ({ name: a.name, value: a.value, line: a.line })),
        blocks: b.blocks.map(summarizeBlock),
      }));
      break;
    case 'terraform': {
      const t = model.terraform;
      const rv = attrString(b, 'required_version');
      if (rv) {
        t.requiredVersion = rv;
        t.requiredVersionFile = file;
      }
      for (const sub of b.blocks) {
        if (sub.type === 'required_providers') {
          for (const a of sub.attributes) {
            t.requiredProviders.push({
              file,
              line: a.line,
              name: a.name,
              source: objectField(a.value, 'source'),
              // 旧形式 `aws = "~> 4.0"` はバージョン制約のみ
              version: objectField(a.value, 'version') || (/^"/.test(a.value) ? stringValue(a.value) : undefined),
              raw: a.value,
            });
          }
        } else if (sub.type === 'backend' || sub.type === 'cloud') {
          t.backend = Object.assign(loc(file, sub), {
            type: sub.type === 'cloud' ? 'cloud' : sub.labels[0],
            attributes: sub.attributes.map((a) => ({ name: a.name, value: a.value, line: a.line })),
          });
        }
      }
      break;
    }
    default:
      // moved / import / removed / check など
      model.others.push(Object.assign(loc(file, b), {
        type: b.type,
        labels: b.labels,
        attributes: b.attributes.map((a) => ({ name: a.name, value: a.value, line: a.line })),
        blocks: b.blocks.map(summarizeBlock),
      }));
  }
}

/** このモジュールを呼び出す module ブロックの雛形を作る */
function usageSnippet(model, sourcePath) {
  const lines = [];
  lines.push('module "' + model.name.replace(/[^A-Za-z0-9_-]/g, '_') + '" {');
  lines.push('  source = "' + sourcePath + '"');
  const required = model.variables.filter((v) => !v.hasDefault);
  const optional = model.variables.filter((v) => v.hasDefault);
  const width = Math.max(0, ...model.variables.map((v) => v.name.length));
  const pad = (s) => s + ' '.repeat(width - s.length);
  const firstLine = (s) => (s || '').split('\n')[0].trim();

  if (required.length) {
    lines.push('');
    lines.push('  # 必須');
    for (const v of required) {
      const desc = v.description ? ' - ' + firstLine(v.description) : '';
      lines.push('  ' + pad(v.name) + ' = null # ' + (firstLine(v.type) || 'any') + desc);
    }
  }
  if (optional.length) {
    lines.push('');
    lines.push('  # 任意（デフォルト値あり）');
    for (const v of optional) {
      const d = v.default.indexOf('\n') === -1 ? v.default : firstLine(v.default) + ' ...';
      lines.push('  # ' + pad(v.name) + ' = ' + d);
    }
  }
  lines.push('}');
  return lines.join('\n');
}

module.exports = { loadModule, usageSnippet };
