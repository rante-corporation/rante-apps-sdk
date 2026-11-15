'use strict';
// CRC-32 (IEEE 802.3), the checksum ZIP stores for every entry.
// zlib.crc32 exists from Node 20.15 / 22.2; the table version below gives the same result on every Node version.

const zlib = require('node:zlib');

let table = null;

function buildTable() {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c;
  }
  return t;
}

/** CRC-32 computed in JavaScript, independent of the zlib build. */
function crc32Portable(buffer) {
  if (!table) table = buildTable();
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/** CRC-32 of a Buffer or Uint8Array, as an unsigned 32-bit integer. */
function crc32(buffer) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buffer) >>> 0;
  return crc32Portable(buffer);
}

module.exports = { crc32, crc32Portable };
