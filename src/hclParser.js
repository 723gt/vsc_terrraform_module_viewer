'use strict';

/**
 * 軽量な HCL ブロックパーサ。
 * 式の評価はせず、ブロック構造（type / labels / attributes / 入れ子ブロック）と
 * 各属性の生テキスト・行番号だけを取り出す。文字列・テンプレート補間・ヒアドキュメント・
 * コメントは正しくスキップするので、波括弧の対応がずれることはない。
 */

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_-]*/y;
const HEREDOC_RE = /<<(-?)([A-Za-z_][A-Za-z0-9_-]*)[ \t]*\r?\n/y;
const OPENERS = { '(': ')', '[': ']', '{': '}' };

class Parser {
  constructor(text) {
    this.text = text;
    this.lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') this.lineStarts.push(i + 1);
    }
  }

  /** オフセット → 1 始まりの行番号 */
  lineOf(offset) {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  readIdent(i) {
    IDENT_RE.lastIndex = i;
    const m = IDENT_RE.exec(this.text);
    return m ? m[0] : null;
  }

  /** コメントなら終端位置を返す（行コメントは改行の手前まで）。それ以外は -1 */
  skipComment(i) {
    const t = this.text;
    const c = t[i];
    if (c === '#' || (c === '/' && t[i + 1] === '/')) {
      const nl = t.indexOf('\n', i);
      return nl === -1 ? t.length : nl;
    }
    if (c === '/' && t[i + 1] === '*') {
      const close = t.indexOf('*/', i + 2);
      return close === -1 ? t.length : close + 2;
    }
    return -1;
  }

  /** i は '"' の位置。閉じ '"' の直後を返す */
  skipString(i) {
    const t = this.text;
    i++;
    while (i < t.length) {
      const c = t[i];
      if (c === '\\') {
        i += 2;
      } else if (c === '"') {
        return i + 1;
      } else if ((c === '$' || c === '%') && t[i + 1] === c) {
        i += 2; // $${ / %%{ はエスケープ
      } else if ((c === '$' || c === '%') && t[i + 1] === '{') {
        i = this.skipBalanced(i + 1);
      } else if (c === '\n') {
        return i; // 閉じられていない文字列
      } else {
        i++;
      }
    }
    return i;
  }

  /** i は '<<' の位置。ヒアドキュメントなら終端マーカー行の末尾（改行の手前）を返す。違えば -1 */
  skipHeredoc(i) {
    const t = this.text;
    HEREDOC_RE.lastIndex = i;
    const m = HEREDOC_RE.exec(t);
    if (!m) return -1;
    const marker = m[2];
    let pos = HEREDOC_RE.lastIndex;
    while (pos < t.length) {
      let nl = t.indexOf('\n', pos);
      if (nl === -1) nl = t.length;
      if (t.slice(pos, nl).trim() === marker) {
        return t[nl - 1] === '\r' ? nl - 1 : nl;
      }
      pos = nl + 1;
    }
    return t.length;
  }

  /** 文字列・ヒアドキュメント・コメントのいずれかならその終端を返す。違えば -1 */
  skipAtom(i) {
    const t = this.text;
    const c = t[i];
    if (c === '"') return this.skipString(i);
    if (c === '<' && t[i + 1] === '<') return this.skipHeredoc(i);
    return this.skipComment(i);
  }

  /** i は開き括弧の位置。対応する閉じ括弧の直後を返す */
  skipBalanced(i) {
    const t = this.text;
    const stack = [OPENERS[t[i]]];
    i++;
    while (i < t.length && stack.length) {
      const c = t[i];
      const atomEnd = this.skipAtom(i);
      if (atomEnd !== -1) {
        i = atomEnd;
        continue;
      }
      if (OPENERS[c]) stack.push(OPENERS[c]);
      else if (c === stack[stack.length - 1]) stack.pop();
      i++;
    }
    return i;
  }

  /** 属性値の式を行末（括弧の外の改行）まで読む。末尾コメントは値に含めない */
  scanExpr(i, end) {
    const t = this.text;
    let valueEnd = i;
    while (i < end) {
      const c = t[i];
      if (c === '\n') break;
      const commentEnd = this.skipComment(i);
      if (commentEnd !== -1) {
        i = commentEnd;
        continue;
      }
      const atomEnd = this.skipAtom(i);
      if (atomEnd !== -1) {
        i = valueEnd = atomEnd;
        continue;
      }
      if (OPENERS[c]) {
        i = valueEnd = this.skipBalanced(i);
        continue;
      }
      i++;
      if (c !== ' ' && c !== '\t' && c !== '\r') valueEnd = i;
    }
    return { end: i, valueEnd: Math.min(valueEnd, end) };
  }

  skipInlineWs(i) {
    const t = this.text;
    while (t[i] === ' ' || t[i] === '\t') i++;
    return i;
  }

  skipTrivia(i, end) {
    const t = this.text;
    while (i < end) {
      const c = t[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === ',') {
        i++;
        continue;
      }
      const commentEnd = this.skipComment(i);
      if (commentEnd !== -1) {
        i = commentEnd;
        continue;
      }
      break;
    }
    return i;
  }

  nextLine(i) {
    const nl = this.text.indexOf('\n', i);
    return nl === -1 ? this.text.length : nl + 1;
  }

  /** [start, end) をボディとして解析する */
  parseBody(start, end) {
    const t = this.text;
    const attributes = [];
    const blocks = [];
    let i = start;

    while (i < end) {
      i = this.skipTrivia(i, end);
      if (i >= end) break;

      const name = this.readIdent(i);
      if (!name) {
        i = this.nextLine(i);
        continue;
      }
      const nameStart = i;
      let j = this.skipInlineWs(i + name.length);

      // 属性: name = expr
      if (t[j] === '=' && t[j + 1] !== '=') {
        const vs = this.skipInlineWs(j + 1);
        const r = this.scanExpr(vs, end);
        attributes.push({
          name,
          value: t.slice(vs, r.valueEnd).trim(),
          line: this.lineOf(nameStart),
          endLine: this.lineOf(Math.max(vs, r.valueEnd - 1)),
        });
        i = r.end;
        continue;
      }

      // ブロック: type "label" label {
      const labels = [];
      let ok = true;
      for (;;) {
        j = this.skipInlineWs(j);
        if (t[j] === '{') break;
        if (t[j] === '"') {
          const se = this.skipString(j);
          labels.push(unquote(t.slice(j, se)));
          j = se;
          continue;
        }
        const label = this.readIdent(j);
        if (label) {
          labels.push(label);
          j += label.length;
          continue;
        }
        ok = false;
        break;
      }
      if (!ok || j >= end) {
        i = this.nextLine(i);
        continue;
      }

      const close = this.skipBalanced(j);
      const body = this.parseBody(j + 1, close - 1);
      blocks.push({
        type: name,
        labels,
        attributes: body.attributes,
        blocks: body.blocks,
        line: this.lineOf(nameStart),
        endLine: this.lineOf(close - 1),
      });
      i = close;
    }

    return { attributes, blocks };
  }
}

/** HCL ファイル全体を解析する */
function parseHcl(text) {
  const p = new Parser(text);
  return p.parseBody(0, text.length);
}

/** "..." を文字列リテラルとして解釈する（補間は生のまま残す） */
function unquote(s) {
  if (s.length < 2 || s[0] !== '"') return s;
  const body = s.endsWith('"') ? s.slice(1, -1) : s.slice(1);
  return body.replace(/\\(.)/g, (_, c) => {
    switch (c) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      default: return c;
    }
  });
}

/**
 * 属性の生値が単純な文字列（クォート文字列・ヒアドキュメント）ならその中身を返す。
 * それ以外の式は生テキストのまま返す。
 */
function stringValue(raw) {
  if (raw == null) return undefined;
  if (/^"(?:[^"\\\n]|\\.)*"$/.test(raw)) return unquote(raw);
  const m = /^<<(-?)([A-Za-z_][A-Za-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\2\s*$/.exec(raw);
  if (m) {
    const lines = m[3].split(/\r?\n/);
    if (m[1] === '-') {
      const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)[0].length);
      const min = indents.length ? Math.min.apply(null, indents) : 0;
      return lines.map((l) => l.slice(min)).join('\n');
    }
    return lines.join('\n');
  }
  return raw;
}

function getAttr(block, name) {
  for (const a of block.attributes) if (a.name === name) return a;
  return undefined;
}

module.exports = { parseHcl, stringValue, unquote, getAttr };
