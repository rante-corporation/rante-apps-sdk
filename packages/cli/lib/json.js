'use strict';
// A strict JSON parser (RFC 8259) for manifest.json.
//
// JSON.parse silently keeps the last of two properties with the same name. Other parsers keep the first, or refuse.
// A manifest with duplicate names could therefore read one way in the CLI and another on a server, so this parser
// refuses duplicates. It also keeps "__proto__" as an ordinary property instead of changing the object's prototype,
// and limits nesting depth.

const MAX_DEPTH = 64;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

class JsonError extends SyntaxError {
  constructor(message, position) {
    super(`${message} (at character ${position + 1})`);
    this.name = 'JsonError';
    this.position = position;
  }
}

function parseJsonStrict(text) {
  if (typeof text !== 'string') throw new TypeError('parseJsonStrict expects a string.');
  let i = 0;

  function fail(message) {
    throw new JsonError(message, i);
  }

  function skipWhitespace() {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else break;
    }
  }

  function parseValue(depth) {
    if (depth > MAX_DEPTH) fail('JSON is nested too deeply');
    skipWhitespace();
    const c = text[i];
    if (c === '{') return parseObject(depth);
    if (c === '[') return parseArray(depth);
    if (c === '"') return parseString();
    if (c === 't') return parseLiteral('true', true);
    if (c === 'f') return parseLiteral('false', false);
    if (c === 'n') return parseLiteral('null', null);
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    if (c === undefined) fail('Unexpected end of JSON');
    fail(`Unexpected character ${JSON.stringify(c)}`);
  }

  function parseObject(depth) {
    i++;
    const result = {};
    const seen = new Set();
    skipWhitespace();
    if (text[i] === '}') {
      i++;
      return result;
    }
    for (;;) {
      skipWhitespace();
      if (text[i] !== '"') fail('Expected a property name in double quotes');
      const keyStart = i;
      const key = parseString();
      if (seen.has(key)) {
        i = keyStart;
        fail(`Duplicate property ${JSON.stringify(key)}`);
      }
      seen.add(key);
      skipWhitespace();
      if (text[i] !== ':') fail('Expected ":" after a property name');
      i++;
      const value = parseValue(depth + 1);
      Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
      skipWhitespace();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        return result;
      }
      fail('Expected "," or "}" in an object');
    }
  }

  function parseArray(depth) {
    i++;
    const result = [];
    skipWhitespace();
    if (text[i] === ']') {
      i++;
      return result;
    }
    for (;;) {
      result.push(parseValue(depth + 1));
      skipWhitespace();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') {
        i++;
        return result;
      }
      fail('Expected "," or "]" in an array');
    }
  }

  function parseString() {
    i++; // opening quote
    let out = '';
    let start = i;
    for (;;) {
      if (i >= text.length) fail('Unterminated string');
      const c = text.charCodeAt(i);
      if (c === 0x22) { // "
        out += text.slice(start, i);
        i++;
        return out;
      }
      if (c < 0x20) fail('Control characters must be escaped inside strings');
      if (c === 0x5c) { // backslash
        out += text.slice(start, i);
        const e = text[i + 1];
        if (e === '"' || e === '\\' || e === '/') out += e;
        else if (e === 'b') out += '\b';
        else if (e === 'f') out += '\f';
        else if (e === 'n') out += '\n';
        else if (e === 'r') out += '\r';
        else if (e === 't') out += '\t';
        else if (e === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid \\u escape');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else fail('Invalid escape sequence');
        i += 2;
        start = i;
        continue;
      }
      i++;
    }
  }

  function parseLiteral(word, value) {
    if (text.startsWith(word, i)) {
      i += word.length;
      return value;
    }
    fail(`Unexpected token; expected ${word}`);
  }

  function parseNumber() {
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (!m) fail('Invalid number');
    i += m[0].length;
    const n = Number(m[0]);
    if (!Number.isFinite(n)) fail('Number out of range');
    return n;
  }

  const value = parseValue(0);
  skipWhitespace();
  if (i !== text.length) fail('Unexpected data after the JSON value');
  return value;
}

module.exports = { parseJsonStrict, JsonError };
