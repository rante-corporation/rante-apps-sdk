'use strict';
// A small, strict ZIP reader and a deterministic ZIP writer: just what a .rante package needs.
//
// The reader never trusts the archive. It refuses ZIP64, split archives, encryption, compression methods other than
// stored and deflate, entries whose local header disagrees with the central directory, overlapping entries (a zip-bomb
// technique), data before the first entry, and names that are not UTF-8. Entry data is inflated with a hard output cap
// equal to the declared size, then checked against the declared size and the CRC-32.
//
// The writer produces byte-identical archives for identical input: fixed timestamps (1980-01-01 00:00), no extra
// fields, UTF-8 names, entries in the order given.

const zlib = require('node:zlib');
const { crc32 } = require('./crc32');

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_DATA_DESCRIPTOR = 0x08074b50;

const FLAG_ENCRYPTED = 0x0001;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;
const FLAG_MASKED_HEADERS = 0x2000;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

const DOS_TIME_MIDNIGHT = 0x0000;
const DOS_DATE_1980_01_01 = 0x0021;

const VERSION_20 = 20; // "2.0": deflate, folders
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

class ZipError extends Error {
  constructor(code, message, path) {
    super(message);
    this.name = 'ZipError';
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

const utf8Fatal = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function decodeName(bytes, flags) {
  if (flags & FLAG_UTF8) {
    try {
      return utf8Fatal.decode(bytes);
    } catch (err) {
      throw new ZipError('name_not_utf8', 'An entry name is marked UTF-8 but is not valid UTF-8.');
    }
  }
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] >= 0x80) {
      throw new ZipError('name_not_utf8',
        'An entry name uses a legacy code page. Repack with UTF-8 names (rante pack, or any current zip tool).');
    }
  }
  return bytes.toString('latin1');
}

// ------------------------------------------------------------------------------------------------ reader

/**
 * Reads the structure of a ZIP archive (no entry data is inflated).
 * @param {Buffer} buf the whole archive
 * @param {{maxEntries?: number, maxCommentBytes?: number}} [limits]
 * @returns {{entries: object[], centralDirectoryOffset: number, commentLength: number}}
 */
function readZip(buf, limits) {
  const maxEntries = (limits && limits.maxEntries) || 5000;
  const maxCommentBytes = (limits && limits.maxCommentBytes !== undefined) ? limits.maxCommentBytes : 1024;

  if (!Buffer.isBuffer(buf)) throw new TypeError('readZip expects a Buffer.');
  if (buf.length < 22) throw new ZipError('zip_invalid', 'The file is too short to be a ZIP archive.');

  // The end of central directory record, comment included, must end exactly at the end of the file.
  let eocd = -1;
  const lowest = Math.max(0, buf.length - 22 - MAX_U16);
  for (let p = buf.length - 22; p >= lowest; p--) {
    if (buf.readUInt32LE(p) === SIG_END && p + 22 + buf.readUInt16LE(p + 20) === buf.length) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) {
    throw new ZipError('zip_invalid', 'The end of central directory record is missing: the archive is damaged or truncated.');
  }

  const diskNumber = buf.readUInt16LE(eocd + 4);
  const centralDisk = buf.readUInt16LE(eocd + 6);
  const entriesOnDisk = buf.readUInt16LE(eocd + 8);
  const entryCount = buf.readUInt16LE(eocd + 10);
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  const commentLength = buf.readUInt16LE(eocd + 20);

  if (entryCount === MAX_U16 || centralSize === MAX_U32 || centralOffset === MAX_U32 ||
      (eocd >= 20 && buf.readUInt32LE(eocd - 20) === SIG_ZIP64_LOCATOR)) {
    throw new ZipError('zip64_not_supported', 'ZIP64 archives are not supported. Packages are at most 50 MiB.');
  }
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new ZipError('zip_invalid', 'Split (multi-volume) archives are not supported.');
  }
  if (commentLength > maxCommentBytes) {
    throw new ZipError('zip_invalid', `The archive comment is ${commentLength} bytes; the limit is ${maxCommentBytes}.`);
  }
  if (centralOffset + centralSize !== eocd) {
    throw new ZipError('zip_invalid', 'The central directory does not end where the end record starts.');
  }
  if (entryCount > maxEntries) {
    throw new ZipError('too_many_entries', `The archive has ${entryCount} entries; the limit is ${maxEntries}.`);
  }

  const entries = [];
  let p = centralOffset;
  for (let n = 0; n < entryCount; n++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new ZipError('zip_invalid', `Central directory entry ${n + 1} is damaged.`);
    }
    const versionMadeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const entryCommentLength = buf.readUInt16LE(p + 32);
    const diskStart = buf.readUInt16LE(p + 34);
    const externalAttributes = buf.readUInt32LE(p + 38);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const next = p + 46 + nameLength + extraLength + entryCommentLength;
    if (next > eocd) throw new ZipError('zip_invalid', `Central directory entry ${n + 1} runs past the end record.`);

    const nameBytes = buf.subarray(p + 46, p + 46 + nameLength);
    const name = decodeName(nameBytes, flags);

    if (compressedSize === MAX_U32 || uncompressedSize === MAX_U32 || localHeaderOffset === MAX_U32) {
      throw new ZipError('zip64_not_supported', `"${name}" uses ZIP64 sizes, which are not supported.`, name);
    }
    if (diskStart !== 0) throw new ZipError('zip_invalid', `"${name}" claims to start on another disk.`, name);
    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION | FLAG_MASKED_HEADERS)) {
      throw new ZipError('zip_encrypted', `"${name}" is encrypted. Packages must not be encrypted.`, name);
    }
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) {
      throw new ZipError('zip_method_unsupported',
        `"${name}" uses compression method ${method}; only stored (0) and deflate (8) are supported.`, name);
    }

    entries.push({
      name, nameBytes, flags, method, crc32: crc, compressedSize, uncompressedSize,
      versionMadeBy, externalAttributes, localHeaderOffset
    });
    p = next;
  }
  if (p !== eocd) throw new ZipError('zip_invalid', 'The central directory has unexpected trailing data.');

  // Local headers must agree with the central directory.
  for (const e of entries) {
    const lh = e.localHeaderOffset;
    if (lh + 30 > centralOffset || buf.readUInt32LE(lh) !== SIG_LOCAL) {
      throw new ZipError('zip_entry_mismatch', `The local header of "${e.name}" is missing.`, e.name);
    }
    const localFlags = buf.readUInt16LE(lh + 6);
    const localMethod = buf.readUInt16LE(lh + 8);
    const localNameLength = buf.readUInt16LE(lh + 26);
    const localExtraLength = buf.readUInt16LE(lh + 28);
    if (lh + 30 + localNameLength + localExtraLength > centralOffset) {
      throw new ZipError('zip_entry_mismatch', `The local header of "${e.name}" runs into the central directory.`, e.name);
    }
    const localName = buf.subarray(lh + 30, lh + 30 + localNameLength);
    if (!localName.equals(e.nameBytes)) {
      throw new ZipError('zip_entry_mismatch',
        `The local header of "${e.name}" names a different file. The archive is damaged or crafted.`, e.name);
    }
    if (localMethod !== e.method || (localFlags & FLAG_ENCRYPTED) !== (e.flags & FLAG_ENCRYPTED) ||
        (localFlags & FLAG_DATA_DESCRIPTOR) !== (e.flags & FLAG_DATA_DESCRIPTOR)) {
      throw new ZipError('zip_entry_mismatch', `The local header of "${e.name}" disagrees with the central directory.`, e.name);
    }
    if (!(localFlags & FLAG_DATA_DESCRIPTOR)) {
      if (buf.readUInt32LE(lh + 14) !== e.crc32 || buf.readUInt32LE(lh + 18) !== e.compressedSize ||
          buf.readUInt32LE(lh + 22) !== e.uncompressedSize) {
        throw new ZipError('zip_entry_mismatch',
          `The local header of "${e.name}" has a different size or CRC than the central directory.`, e.name);
      }
    }
    e.dataOffset = lh + 30 + localNameLength + localExtraLength;
    e.dataEnd = e.dataOffset + e.compressedSize;
    if (e.dataEnd > centralOffset) {
      throw new ZipError('zip_invalid', `The data of "${e.name}" runs into the central directory.`, e.name);
    }
    e.recordEnd = e.dataEnd;
    if (localFlags & FLAG_DATA_DESCRIPTOR) {
      e.recordEnd = readDataDescriptor(buf, e, centralOffset);
    }
  }

  // No data before the first entry, and no two entries may share bytes.
  const byOffset = entries.slice().sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  if (byOffset.length > 0 && byOffset[0].localHeaderOffset !== 0) {
    throw new ZipError('zip_invalid', 'The archive has data before its first entry.');
  }
  for (let i = 1; i < byOffset.length; i++) {
    if (byOffset[i].localHeaderOffset < byOffset[i - 1].recordEnd) {
      throw new ZipError('zip_entry_overlap',
        `"${byOffset[i].name}" overlaps "${byOffset[i - 1].name}". Overlapping entries are a zip-bomb technique.`,
        byOffset[i].name);
    }
  }

  return { entries, centralDirectoryOffset: centralOffset, commentLength };
}

function readDataDescriptor(buf, e, limit) {
  let q = e.dataEnd;
  if (q + 4 <= limit && buf.readUInt32LE(q) === SIG_DATA_DESCRIPTOR) q += 4;
  if (q + 12 > limit) {
    throw new ZipError('zip_invalid', `The data descriptor of "${e.name}" is missing.`, e.name);
  }
  if (buf.readUInt32LE(q) !== e.crc32 || buf.readUInt32LE(q + 4) !== e.compressedSize ||
      buf.readUInt32LE(q + 8) !== e.uncompressedSize) {
    throw new ZipError('zip_entry_mismatch',
      `The data descriptor of "${e.name}" disagrees with the central directory.`, e.name);
  }
  return q + 12;
}

/**
 * Returns an entry's bytes. Deflated data is inflated with an output cap equal to the declared size, so an entry can
 * never expand beyond what the central directory promised; the size and CRC-32 are then checked.
 */
function readEntryData(buf, entry) {
  const raw = buf.subarray(entry.dataOffset, entry.dataEnd);
  let data;
  if (entry.method === METHOD_STORED) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new ZipError('zip_size_mismatch', `"${entry.name}" is stored but its two sizes differ.`, entry.name);
    }
    data = raw;
  } else {
    try {
      data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
    } catch (err) {
      if (err && (err.code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError)) {
        throw new ZipError('zip_size_mismatch',
          `"${entry.name}" inflates to more than its declared ${entry.uncompressedSize} bytes.`, entry.name);
      }
      throw new ZipError('zip_invalid', `"${entry.name}" has damaged compressed data.`, entry.name);
    }
  }
  if (data.length !== entry.uncompressedSize) {
    throw new ZipError('zip_size_mismatch',
      `"${entry.name}" is ${data.length} bytes, not the declared ${entry.uncompressedSize}.`, entry.name);
  }
  if (crc32(data) !== entry.crc32) {
    throw new ZipError('zip_crc_mismatch', `"${entry.name}" fails its CRC-32 check: the archive is damaged.`, entry.name);
  }
  return data;
}

// ------------------------------------------------------------------------------------------------ writer

/**
 * Writes a ZIP archive. Identical input gives identical bytes.
 * @param {{name: string, data: Buffer, compress?: boolean, versionMadeBy?: number, externalAttributes?: number}[]} files
 *   entries in the order they are written; `compress: false` stores the entry. `versionMadeBy` and
 *   `externalAttributes` exist only so tests can build unusual archives.
 * @returns {Buffer}
 */
function writeZip(files) {
  if (files.length >= MAX_U16) throw new ZipError('too_many_entries', 'Too many entries for a ZIP archive without ZIP64.');
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = Buffer.from(f.name, 'utf8');
    if (nameBytes.length === 0 || nameBytes.length > MAX_U16) throw new ZipError('path_invalid', 'An entry name is empty or too long.');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const crc = crc32(data);
    let method = METHOD_STORED;
    let payload = data;
    if (f.compress !== false && data.length > 0) {
      const deflated = zlib.deflateRawSync(data, { level: 9 });
      if (deflated.length < data.length) {
        method = METHOD_DEFLATE;
        payload = deflated;
      }
    }
    if (data.length >= MAX_U32 || payload.length >= MAX_U32 || offset >= MAX_U32) {
      throw new ZipError('zip64_not_supported', 'The archive would need ZIP64.');
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(VERSION_20, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME_MIDNIGHT, 10);
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBytes, payload);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(SIG_CENTRAL, 0);
    header.writeUInt16LE(f.versionMadeBy !== undefined ? f.versionMadeBy : VERSION_20, 4); // host 0 (MS-DOS), spec 2.0
    header.writeUInt16LE(VERSION_20, 6);
    header.writeUInt16LE(FLAG_UTF8, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(DOS_TIME_MIDNIGHT, 12);
    header.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(payload.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE((f.externalAttributes !== undefined ? f.externalAttributes : 0) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);

    offset += 30 + nameBytes.length + payload.length;
  }

  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat(parts.concat([centralBytes, end]));
}

module.exports = {
  ZipError,
  readZip,
  readEntryData,
  writeZip,
  constants: {
    SIG_LOCAL, SIG_CENTRAL, SIG_END, FLAG_UTF8, FLAG_DATA_DESCRIPTOR, FLAG_ENCRYPTED, METHOD_STORED, METHOD_DEFLATE
  }
};
