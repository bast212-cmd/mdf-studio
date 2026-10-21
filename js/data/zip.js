// Lecture / écriture de fichiers ZIP, sans dépendance.
// Écriture : sans compression (les photos JPEG sont déjà compressées).
// Lecture : fichiers stockés ou compressés (deflate, via DecompressionStream si disponible).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const enc = new TextEncoder();

/**
 * Crée un ZIP.
 * @param {{name:string, data:Blob|string|Uint8Array}[]} files
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function createZip(files, onProgress) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const nameBytes = enc.encode(f.name);
    const bytes = typeof f.data === 'string' ? enc.encode(f.data)
      : f.data instanceof Uint8Array ? f.data
        : new Uint8Array(await f.data.arrayBuffer());
    const crc = crc32(bytes);
    const size = bytes.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);        // version
    local.setUint16(6, 0x0800, true);    // drapeau UTF-8
    local.setUint16(8, 0, true);         // stocké sans compression
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    // pour un Blob, on garde le Blob (et non ses octets) : la mémoire est libérée au fur et à mesure
    parts.push(local.buffer, nameBytes, f.data instanceof Blob ? f.data : bytes);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, nameBytes);

    offset += 30 + nameBytes.length + size;
    onProgress?.(i + 1, files.length);
  }

  const cdSize = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/**
 * Lit un ZIP. Renvoie une Map nom -> { blob(): Promise<Blob>, text(): Promise<string> }
 * @param {Blob} blob
 */
export async function readZip(blob) {
  // Fin du répertoire central : dans les 64 derniers Ko
  const tailLen = Math.min(blob.size, 65557);
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Ce fichier n'est pas une archive ZIP valide.");
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('Archive ZIP endommagée.');
    const method = cd.getUint16(p + 10, true);
    const compSize = cd.getUint32(p + 20, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const localOffset = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;

    const getBlob = async () => {
      const lh = new DataView(await blob.slice(localOffset, localOffset + 30).arrayBuffer());
      const start = localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const raw = blob.slice(start, start + compSize);
      if (method === 0) return raw;
      if (method === 8) {
        if (typeof DecompressionStream === 'undefined') throw new Error('Archive compressée non prise en charge par ce navigateur.');
        return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      }
      throw new Error(`Méthode de compression ZIP non prise en charge (${method}).`);
    };
    entries.set(name, { name, blob: getBlob, text: async () => (await getBlob()).text() });
  }
  return entries;
}
