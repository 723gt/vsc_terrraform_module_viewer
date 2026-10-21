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
 */
function loadModule(dir) {
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

  const texts = [];

  for (const file of files) {
    const full = path.join(dir, file);
    let text;
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch (e) {
      model.errors.push({ file, message: String(e.message || e) });
      continue;
    }
    texts.push(text);

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
  for (const v of model.variables) v.refs = countRefs(texts, 'var', v.name);
  for (const l of model.locals) l.refs = countRefs(texts, 'local', l.name);

  return model;
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
      if (rv) t.requiredVersion = rv;
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
