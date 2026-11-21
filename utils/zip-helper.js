/**
 * Minimal Standalone ZIP Builder in Pure JavaScript (Store Mode)
 * Compatible with both Window and ServiceWorker (self).
 */
class SimpleZip {
  constructor() {
    this.files = [];
    this._crcTable = this._makeCrcTable();
  }

  _makeCrcTable() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    return table;
  }

  _crc32(uint8Array) {
    let crc = 0 ^ (-1);
    for (let i = 0; i < uint8Array.length; i++) {
      crc = (crc >>> 8) ^ this._crcTable[(crc ^ uint8Array[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }

  addFile(name, data) {
    const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.files.push({
      name,
      data: uint8,
      crc: this._crc32(uint8),
      size: uint8.length
    });
  }

  file(name, data) {
    this.addFile(name, data);
  }

  generate() {
    const textEncoder = new TextEncoder();
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    const date = new Date();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

    for (const file of this.files) {
      const nameBytes = textEncoder.encode(file.name);
      
      // --- Local File Header ---
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(localHeader.buffer);
      lv.setUint32(0, 0x04034b50, true);   // Signature
      lv.setUint16(4, 20, true);           // Version
      lv.setUint16(6, 0x0800, true);       // UTF-8 flag
      lv.setUint16(8, 0, true);            // Store
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, file.crc, true);
      lv.setUint32(18, file.size, true);   // Compressed size
      lv.setUint32(22, file.size, true);   // Uncompressed size
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);

      localHeaders.push(localHeader);
      localHeaders.push(file.data);

      // --- Central Directory Header ---
      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(centralHeader.buffer);
      cv.setUint32(0, 0x02014b50, true);   // Signature
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, file.crc, true);
      cv.setUint32(20, file.size, true);
      cv.setUint32(24, file.size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      centralHeader.set(nameBytes, 46);

      centralHeaders.push(centralHeader);
      offset += localHeader.length + file.size;
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const h of centralHeaders) centralDirSize += h.length;

    // --- End of Central Directory Record ---
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, this.files.length, true);
    ev.setUint16(10, this.files.length, true);
    ev.setUint32(12, centralDirSize, true);
    ev.setUint32(16, centralDirOffset, true);
    ev.setUint16(20, 0, true);

    const allParts = [...localHeaders, ...centralHeaders, eocd];
    return new Blob(allParts, { type: 'application/zip' });
  }

  generateUint8Array() {
    const textEncoder = new TextEncoder();
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    const date = new Date();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

    for (const file of this.files) {
      const nameBytes = textEncoder.encode(file.name);
      
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(localHeader.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, file.crc, true);
      lv.setUint32(18, file.size, true);
      lv.setUint32(22, file.size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);

      localHeaders.push(localHeader);
      localHeaders.push(file.data);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(centralHeader.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, file.crc, true);
      cv.setUint32(20, file.size, true);
      cv.setUint32(24, file.size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      centralHeader.set(nameBytes, 46);

      centralHeaders.push(centralHeader);
      offset += localHeader.length + file.size;
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const h of centralHeaders) centralDirSize += h.length;

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, this.files.length, true);
    ev.setUint16(10, this.files.length, true);
    ev.setUint32(12, centralDirSize, true);
    ev.setUint32(16, centralDirOffset, true);
    ev.setUint16(20, 0, true);

    let totalLen = 0;
    const parts = [...localHeaders, ...centralHeaders, eocd];
    for (const p of parts) totalLen += p.length;
    const result = new Uint8Array(totalLen);
    let curOffset = 0;
    for (const p of parts) {
      result.set(p, curOffset);
      curOffset += p.length;
    }
    return result;
  }
}

if (typeof self !== 'undefined') {
  self.SimpleZip = SimpleZip;
  self.MiniZip = SimpleZip;
}
if (typeof window !== 'undefined') {
  window.SimpleZip = SimpleZip;
  window.MiniZip = SimpleZip;
}
