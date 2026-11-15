'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseJsonStrict } = require('../lib/json');

test('parses what JSON.parse parses', () => {
  const samples = [
    '{}', '[]', '0', '-1.5e3', '"text"', 'true', 'false', 'null',
    '{"a":[1,2,{"b":null}],"c":"\\u00e9\\n\\t\\"\\\\\\/","d":-0.25E+2}',
    '  {\n  "name" : "x" , "list" : [ ] }  '
  ];
  for (const s of samples) assert.deepEqual(parseJsonStrict(s), JSON.parse(s), s);
});

test('refuses duplicate property names', () => {
  assert.throws(() => parseJsonStrict('{"id":"a","id":"b"}'), /Duplicate property "id"/);
  assert.throws(() => parseJsonStrict('{"x":{"k":1,"k":2}}'), /Duplicate property "k"/);
});

test('keeps __proto__ as an ordinary property', () => {
  const value = parseJsonStrict('{"__proto__":{"polluted":true}}');
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.deepEqual(Object.keys(value), ['__proto__']);
  assert.equal(({}).polluted, undefined);
});

test('refuses invalid JSON', () => {
  const bad = ['', '{', '{"a":1,}', '[1,]', "{'a':1}", '01', '1.', '.5', '+1', 'NaN', 'tru', '"\u0001"',
    '"\\x41"', '"\\u12"', '{"a" 1}', '{} {}', '[1] x'];
  for (const s of bad) assert.throws(() => parseJsonStrict(s), SyntaxError, JSON.stringify(s));
});

test('limits nesting depth', () => {
  assert.doesNotThrow(() => parseJsonStrict('['.repeat(60) + ']'.repeat(60)));
  assert.throws(() => parseJsonStrict('['.repeat(70) + ']'.repeat(70)), /nested too deeply/);
});
