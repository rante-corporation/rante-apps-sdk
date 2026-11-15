'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { crc32, crc32Portable } = require('../lib/crc32');

test('CRC-32 of the standard check string is CBF43926', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32Portable(Buffer.from('123456789')), 0xcbf43926);
});

test('CRC-32 of empty input is 0', () => {
  assert.equal(crc32(Buffer.alloc(0)), 0);
  assert.equal(crc32Portable(Buffer.alloc(0)), 0);
});

test('the JavaScript table and zlib agree on random data', () => {
  for (let i = 0; i < 20; i++) {
    const data = crypto.randomBytes(1 + i * 997);
    assert.equal(crc32Portable(data), crc32(data));
  }
});
