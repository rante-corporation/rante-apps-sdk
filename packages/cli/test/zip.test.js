'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readZip, readEntryData, writeZip, ZipError, constants } = require('../lib/zip');

function sample() {
  return writeZip([
    { name: 'manifest.json', data: Buffer.from('{"a":1}') },
    { name: 'index.html', data: Buffer.from('<p>hello</p>'.repeat(50)) },
    { name: 'empty.txt', data: Buffer.alloc(0) },
    { name: 'img/pixel.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), compress: false }
  ]);
}

function expectZipError(fn, code) {
  assert.throws(fn, (err) => err instanceof ZipError && err.code === code, code);
}

test('writes and reads back entries, deflating only when it helps', () => {
  const zip = sample();
  assert.deepEqual([...zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const { entries } = readZip(zip);
  assert.deepEqual(entries.map((e) => e.name), ['manifest.json', 'index.html', 'empty.txt', 'img/pixel.png']);
  const html = entries[1];
  assert.equal(html.method, constants.METHOD_DEFLATE);
  assert.equal(readEntryData(zip, html).toString(), '<p>hello</p>'.repeat(50));
  assert.equal(entries[3].method, constants.METHOD_STORED);
  assert.equal(readEntryData(zip, entries[2]).length, 0);
});

test('identical input gives identical bytes', () => {
  assert.equal(Buffer.compare(sample(), sample()), 0);
});

test('accepts an archive comment that ends exactly at the end of the file', () => {
  const zip = sample();
  const withComment = Buffer.concat([zip, Buffer.from('hi')]);
  withComment.writeUInt16LE(2, withComment.length - 2 - 2);
  assert.equal(readZip(withComment).commentLength, 2);
});

test('refuses truncated and damaged archives', () => {
  const zip = sample();
  expectZipError(() => readZip(zip.subarray(0, zip.length - 5)), 'zip_invalid');
  expectZipError(() => readZip(Buffer.from('PK')), 'zip_invalid');
  const extra = Buffer.concat([zip, Buffer.from('trailing')]);
  expectZipError(() => readZip(extra), 'zip_invalid');
});

test('refuses ZIP64 and split archives', () => {
  const zip = Buffer.from(sample());
  const eocd = zip.length - 22;
  const z64 = Buffer.from(zip);
  z64.writeUInt16LE(0xffff, eocd + 10);
  expectZipError(() => readZip(z64), 'zip64_not_supported');
  const split = Buffer.from(zip);
  split.writeUInt16LE(1, eocd + 4);
  expectZipError(() => readZip(split), 'zip_invalid');
});

function centralOffsets(zip) {
  const eocd = zip.length - 22;
  let p = zip.readUInt32LE(eocd + 16);
  const offsets = [];
  while (p < eocd) {
    offsets.push(p);
    p += 46 + zip.readUInt16LE(p + 28) + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return offsets;
}

test('refuses encrypted entries and unsupported compression methods', () => {
  const zip = Buffer.from(sample());
  const [first] = centralOffsets(zip);
  const enc = Buffer.from(zip);
  enc.writeUInt16LE(zip.readUInt16LE(first + 8) | 1, first + 8);
  expectZipError(() => readZip(enc), 'zip_encrypted');
  const bzip = Buffer.from(zip);
  bzip.writeUInt16LE(12, first + 10);
  expectZipError(() => readZip(bzip), 'zip_method_unsupported');
});

test('refuses a local header that names a different file', () => {
  const zip = Buffer.from(sample());
  zip.write('X', 30); // first byte of the first local file name
  expectZipError(() => readZip(zip), 'zip_entry_mismatch');
});

test('refuses two central entries that point at the same local header', () => {
  const zip = Buffer.from(sample());
  const offsets = centralOffsets(zip);
  const overlapped = Buffer.from(zip);
  overlapped.writeUInt32LE(0, offsets[1] + 42);
  expectZipError(() => readZip(overlapped), 'zip_entry_mismatch');
});

test('refuses overlapping entries (zip bomb technique)', () => {
  const zip = Buffer.from(writeZip([
    { name: 'a.txt', data: Buffer.from('aaaa'), compress: false },
    { name: 'b.txt', data: Buffer.from('bbbb'), compress: false }
  ]));
  // Grow the first entry so its data runs over the second entry's local header (in both headers, consistently).
  const [cdA] = centralOffsets(zip);
  for (const offset of [18, 22, cdA + 20, cdA + 24]) zip.writeUInt32LE(10, offset);
  expectZipError(() => readZip(zip), 'zip_entry_overlap');
});

test('refuses data before the first entry', () => {
  const inner = sample();
  const prefixed = Buffer.concat([Buffer.from('JUNK'), inner]);
  // Shift every offset by 4 so the structure stays self-consistent apart from the prefix.
  const eocd = prefixed.length - 22;
  prefixed.writeUInt32LE(prefixed.readUInt32LE(eocd + 16) + 4, eocd + 16);
  for (const off of centralOffsets(prefixed)) prefixed.writeUInt32LE(prefixed.readUInt32LE(off + 42) + 4, off + 42);
  expectZipError(() => readZip(prefixed), 'zip_invalid');
});

test('checks the CRC and the declared size when reading data', () => {
  const zip = Buffer.from(writeZip([{ name: 'a.txt', data: Buffer.from('abcdef'), compress: false }]));
  const corrupt = Buffer.from(zip);
  corrupt[30 + 'a.txt'.length] ^= 0xff;
  const { entries } = readZip(corrupt);
  expectZipError(() => readEntryData(corrupt, entries[0]), 'zip_crc_mismatch');
});

test('never inflates beyond the declared size', () => {
  const big = Buffer.alloc(100000, 0x61);
  const zip = Buffer.from(writeZip([{ name: 'a.txt', data: big }]));
  const [cd] = centralOffsets(zip);
  // Claim the entry is only 1000 bytes in both headers.
  zip.writeUInt32LE(1000, cd + 24);
  zip.writeUInt32LE(1000, 22);
  const { entries } = readZip(zip);
  assert.equal(entries[0].method, constants.METHOD_DEFLATE);
  assert.ok(entries[0].compressedSize < 1000);
  expectZipError(() => readEntryData(zip, entries[0]), 'zip_size_mismatch');
});

test('refuses non-UTF-8 names without the UTF-8 flag', () => {
  const zip = Buffer.from(writeZip([{ name: 'a.txt', data: Buffer.from('x'), compress: false }]));
  const [cd] = centralOffsets(zip);
  zip.writeUInt16LE(0, cd + 8); // clear the UTF-8 flag in the central directory
  zip[cd + 46] = 0xe9; // and use a byte from a legacy code page
  expectZipError(() => readZip(zip), 'name_not_utf8');
});

test('limits the number of entries', () => {
  const files = Array.from({ length: 12 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from(String(i)) }));
  expectZipError(() => readZip(writeZip(files), { maxEntries: 10 }), 'too_many_entries');
});
