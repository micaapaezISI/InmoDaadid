/* =====================================================================
   ZIP LITE — lector de archivos .zip 100% en el navegador, sin
   dependencias externas ni conexión a internet.
   ---------------------------------------------------------------------
   Soporta los dos métodos de compresión que usa prácticamente cualquier
   .zip generado por Windows, macOS, o cualquier programa estándar:
     - Sin comprimir ("stored")
     - DEFLATE (el más común)
   No soporta ZIP64 (archivos/zips extremadamente grandes, > 4 GB) ni
   .zip protegidos con contraseña — no hace falta para fotos de una
   propiedad.

   Expone: window.ZipLite.unzip(arrayBuffer) -> Promise<Array<{name, bytes}>>
   ===================================================================== */

(function (global) {
  "use strict";

  /* ------------------------- INFLATE (RFC 1951) ------------------------- */

  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CLC_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function BitStream(input) {
    this.input = input;
    this.inpos = 0;
    this.bitbuf = 0;
    this.bitcnt = 0;
  }

  function getBits(s, n) {
    while (s.bitcnt < n) {
      if (s.inpos >= s.input.length) throw new Error("Fin inesperado del stream DEFLATE.");
      s.bitbuf |= s.input[s.inpos++] << s.bitcnt;
      s.bitcnt += 8;
    }
    const val = s.bitbuf & ((1 << n) - 1);
    s.bitbuf >>>= n;
    s.bitcnt -= n;
    return val;
  }

  // Construcción canónica de Huffman a partir de un array de longitudes de código por símbolo.
  function buildHuffman(lengths) {
    const MAXBITS = 15;
    const counts = new Array(MAXBITS + 1).fill(0);
    for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
    counts[0] = 0;

    const offs = new Array(MAXBITS + 2).fill(0);
    for (let len = 1; len <= MAXBITS; len++) offs[len + 1] = offs[len] + counts[len];

    const symbols = new Array(lengths.length).fill(0);
    for (let sym = 0; sym < lengths.length; sym++) {
      if (lengths[sym] !== 0) symbols[offs[lengths[sym]]++] = sym;
    }
    return { counts, symbols };
  }

  // Decodifica un símbolo Huffman leyendo bit a bit (algoritmo clásico de "puff.c").
  function decodeSymbol(s, huff) {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= getBits(s, 1);
      const count = huff.counts[len];
      if (code - first < count) return huff.symbols[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error("Código Huffman inválido en el .zip.");
  }

  function inflateCodes(s, out, litHuff, distHuff) {
    while (true) {
      const sym = decodeSymbol(s, litHuff);
      if (sym < 256) {
        out.bytes[out.pos++] = sym;
      } else if (sym === 256) {
        break;
      } else {
        const idx = sym - 257;
        if (idx < 0 || idx >= LEN_BASE.length) throw new Error("Código de longitud inválido.");
        const len = LEN_BASE[idx] + getBits(s, LEN_EXTRA[idx]);
        const distSym = decodeSymbol(s, distHuff);
        const dist = DIST_BASE[distSym] + getBits(s, DIST_EXTRA[distSym]);
        let from = out.pos - dist;
        for (let i = 0; i < len; i++) out.bytes[out.pos++] = out.bytes[from++];
      }
    }
  }

  function inflateStored(s, out) {
    s.bitbuf = 0;
    s.bitcnt = 0; // descarta bits sueltos del byte actual para alinear
    const len = s.input[s.inpos] | (s.input[s.inpos + 1] << 8);
    s.inpos += 4; // LEN (2) + NLEN (2)
    for (let i = 0; i < len; i++) out.bytes[out.pos++] = s.input[s.inpos++];
  }

  function fixedTables() {
    const litLens = new Array(288);
    let i = 0;
    for (; i < 144; i++) litLens[i] = 8;
    for (; i < 256; i++) litLens[i] = 9;
    for (; i < 280; i++) litLens[i] = 7;
    for (; i < 288; i++) litLens[i] = 8;
    const distLens = new Array(30).fill(5);
    return { lit: buildHuffman(litLens), dist: buildHuffman(distLens) };
  }

  function dynamicTables(s) {
    const hlit = getBits(s, 5) + 257;
    const hdist = getBits(s, 5) + 1;
    const hclen = getBits(s, 4) + 4;

    const clLens = new Array(19).fill(0);
    for (let i = 0; i < hclen; i++) clLens[CLC_ORDER[i]] = getBits(s, 3);
    const clHuff = buildHuffman(clLens);

    const lengths = new Array(hlit + hdist).fill(0);
    let i = 0;
    while (i < lengths.length) {
      const sym = decodeSymbol(s, clHuff);
      if (sym < 16) {
        lengths[i++] = sym;
      } else if (sym === 16) {
        const repeat = getBits(s, 2) + 3;
        const prev = lengths[i - 1];
        for (let r = 0; r < repeat && i < lengths.length; r++) lengths[i++] = prev;
      } else if (sym === 17) {
        const repeat = getBits(s, 3) + 3;
        for (let r = 0; r < repeat && i < lengths.length; r++) lengths[i++] = 0;
      } else {
        const repeat = getBits(s, 7) + 11;
        for (let r = 0; r < repeat && i < lengths.length; r++) lengths[i++] = 0;
      }
    }

    return { lit: buildHuffman(lengths.slice(0, hlit)), dist: buildHuffman(lengths.slice(hlit)) };
  }

  function inflateRaw(input, outputSize) {
    const out = { bytes: new Uint8Array(outputSize), pos: 0 };
    const s = new BitStream(input);
    let final = 0;
    do {
      final = getBits(s, 1);
      const type = getBits(s, 2);
      if (type === 0) {
        inflateStored(s, out);
      } else if (type === 1) {
        const t = fixedTables();
        inflateCodes(s, out, t.lit, t.dist);
      } else if (type === 2) {
        const t = dynamicTables(s);
        inflateCodes(s, out, t.lit, t.dist);
      } else {
        throw new Error("Bloque DEFLATE inválido (tipo 3).");
      }
    } while (!final);
    return out.bytes;
  }

  /* --------------------------- Lectura de ZIP --------------------------- */

  const EOCD_SIG = 0x06054b50;
  const CENTRAL_SIG = 0x02014b50;
  const LOCAL_SIG = 0x04034b50;

  const IMAGE_MIME = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
  };

  function extensionOf(name) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(name);
    return m ? m[1].toLowerCase() : "";
  }

  async function unzip(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);

    let eocdOffset = -1;
    const maxBack = Math.min(bytes.length, 65557);
    for (let i = bytes.length - 22; i >= bytes.length - maxBack && i >= 0; i--) {
      if (view.getUint32(i, true) === EOCD_SIG) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) {
      throw new Error("El archivo no parece ser un .zip válido.");
    }

    const entryCount = view.getUint16(eocdOffset + 10, true);
    const centralDirOffset = view.getUint32(eocdOffset + 16, true);

    const decoder = new TextDecoder("utf-8");
    const entries = [];
    let offset = centralDirOffset;

    for (let n = 0; n < entryCount; n++) {
      if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_SIG) break;
      const compressionMethod = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLen = view.getUint16(offset + 28, true);
      const extraLen = view.getUint16(offset + 30, true);
      const commentLen = view.getUint16(offset + 32, true);
      const localHeaderOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));

      entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
      offset += 46 + nameLen + extraLen + commentLen;
    }

    const results = [];
    for (const entry of entries) {
      if (entry.name.endsWith("/")) continue; // carpeta
      if (entry.name.startsWith("__MACOSX/")) continue;

      const baseName = entry.name.split("/").pop();
      if (!baseName || baseName.startsWith(".")) continue;

      const ext = extensionOf(baseName);
      const mime = IMAGE_MIME[ext];
      if (!mime) continue; // solo nos interesan imágenes

      if (view.getUint32(entry.localHeaderOffset, true) !== LOCAL_SIG) continue;
      const localNameLen = view.getUint16(entry.localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(entry.localHeaderOffset + 28, true);
      const dataStart = entry.localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compressedData = bytes.subarray(dataStart, dataStart + entry.compressedSize);

      let outBytes;
      try {
        if (entry.compressionMethod === 0) {
          outBytes = compressedData.slice();
        } else if (entry.compressionMethod === 8) {
          outBytes = inflateRaw(compressedData, entry.uncompressedSize);
        } else {
          continue; // método de compresión no soportado
        }
      } catch (err) {
        console.error(`No se pudo leer "${entry.name}" dentro del .zip:`, err);
        continue;
      }

      results.push({ name: baseName, bytes: outBytes, mime });
    }

    return results;
  }

  global.ZipLite = { unzip };
})(window);
