'use strict';

// Match PG export escaping without changing the decoded value or line endings.
function stringifyPgValue(value) {
  return JSON.stringify(value).replace(/[='<>&\u2028\u2029]/g,
    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
}

// Work with source spans so unrelated formatting and number literals survive edits.
function inspect(text) {
  const data = JSON.parse(text);
  if (!data || typeof data.pageId !== 'string' || !Array.isArray(data.views?.rows)) {
    throw new Error('不是谷神页面 JSON：需要 pageId 和 views.rows。');
  }
  let offset = 0;
  const spans = new Map();
  function whitespace() { while (/\s/.test(text[offset] || '') && offset < text.length) offset++; }
  function stringEnd() {
    offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '\\') offset++;
      else if (char === '"') return;
    }
    throw new Error('字符串未闭合。');
  }
  function value(path) {
    whitespace();
    const start = offset;
    const char = text[offset];
    if (char === '{') {
      offset++; whitespace();
      const keys = new Set();
      while (text[offset] !== '}') {
        const keyStart = offset;
        stringEnd();
        const key = JSON.parse(text.slice(keyStart, offset));
        if (keys.has(key)) throw new Error('JSON 含重复键：' + key);
        keys.add(key);
        whitespace(); offset++; // colon, already validated by JSON.parse
        value([...path, key]); whitespace();
        if (text[offset] !== ',') break;
        offset++; whitespace();
      }
      offset++;
    } else if (char === '[') {
      offset++; whitespace();
      let index = 0;
      while (text[offset] !== ']') {
        value([...path, index++]); whitespace();
        if (text[offset] !== ',') break;
        offset++; whitespace();
      }
      offset++;
    } else if (char === '"') stringEnd();
    else while (offset < text.length && !/[\s,}\]]/.test(text[offset])) offset++;
    spans.set(JSON.stringify(path), { start, end: offset });
  }
  value([]);
  return { data, spans };
}

function isEditablePath(path) {
  const serviceEvent = path.at(-2) === 'serviceEvents';
  return (['pageSetup','views'].includes(path[0]) ||
      (path[0] === 'modalSaveBnt' && ['pageEvents','serviceEvents'].includes(path[1]))) &&
    (path.includes('fields') || path.includes('pageEvents') || serviceEvent) &&
    (!path.includes('serviceEvents') || serviceEvent) &&
    !path.some(key => ['datasource','pageId','guid','id','fieldId','__proto__','prototype','constructor'].includes(key));
}

function createEdit(text, path, nextValue) {
  if (!Array.isArray(path) || path.length > 128 || path.some(p => typeof p !== 'string' && !Number.isInteger(p))) {
    throw new Error('修改路径无效。');
  }
  const { data, spans } = inspect(text);
  if (!isEditablePath(path)) throw new Error('当前版本不支持修改此属性。');
  let previous = data;
  for (const part of path) {
    if (previous === null || typeof previous !== 'object' || !Object.hasOwn(previous, part)) throw new Error('属性不存在。');
    previous = previous[part];
  }
  const scalar = v => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  if (!scalar(previous) || !scalar(nextValue) || (typeof nextValue === 'number' && !Number.isFinite(nextValue))) {
    throw new Error('仅支持简单属性值（字符串、有限数字、布尔值或 null），不支持对象或数组替换：/' + path.join('/'));
  }
  if (path.some(key => ['pageEvents','serviceEvents'].includes(key)) && typeof nextValue !== 'string') throw new Error('事件必须是脚本文本。');
  const span = spans.get(JSON.stringify(path));
  if (!span) throw new Error('修改路径不存在。');
  return { ...span, text: Object.is(previous, nextValue) ? text.slice(span.start, span.end) : stringifyPgValue(nextValue) };
}

module.exports = { inspect, createEdit, stringifyPgValue, isEditablePath };
