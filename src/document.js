'use strict';

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

function createEdit(text, path, nextValue) {
  if (!Array.isArray(path) || path.length > 128 || path.some(p => typeof p !== 'string' && !Number.isInteger(p))) {
    throw new Error('修改路径无效。');
  }
  const { data, spans } = inspect(text);
  const editable = (path[0] === 'pageSetup' || path[0] === 'views' ||
      (path[0] === 'modalSaveBnt' && path[1] === 'pageEvents')) &&
    (path.includes('fields') || path.includes('pageEvents')) &&
    !path.some(p => ['serviceEvents', 'datasource', 'pageId', 'guid', 'id'].includes(p));
  if (!editable) throw new Error('首版不支持修改此属性。');
  let previous = data;
  for (const part of path) {
    if (previous === null || typeof previous !== 'object' || !Object.hasOwn(previous, part)) throw new Error('属性不存在。');
    previous = previous[part];
  }
  const scalar = v => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  if (!scalar(previous) || !scalar(nextValue) || typeof previous !== typeof nextValue ||
      (previous === null) !== (nextValue === null) || (typeof nextValue === 'number' && !Number.isFinite(nextValue))) {
    throw new Error('属性类型必须保持不变，仅支持已有的简单属性。');
  }
  if (path.includes('pageEvents') && typeof nextValue !== 'string') throw new Error('事件必须是脚本文本。');
  const span = spans.get(JSON.stringify(path));
  if (!span) throw new Error('修改路径不存在。');
  return { ...span, text: JSON.stringify(nextValue) };
}

module.exports = { inspect, createEdit };
