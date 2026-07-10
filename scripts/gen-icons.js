// One-off script to generate placeholder PWA icons (solid background + "L" mark).
// Run with: node scripts/gen-icons.js
// Replace /public/icons/icon-192.png and icon-512.png with real branded icons later.
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makeIcon(size, outPath) {
  const bg = [10, 10, 10]; // #0a0a0a
  const accent = [34, 197, 94]; // #22c55e

  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 3;
      // Draw a simple green "L" bar mark on dark background
      const barW = Math.floor(size * 0.14);
      const inVerticalBar = x >= size * 0.32 && x < size * 0.32 + barW && y >= size * 0.22 && y < size * 0.78;
      const inHorizontalBar = y >= size * 0.64 && y < size * 0.64 + barW && x >= size * 0.32 && x < size * 0.68;
      const isAccent = inVerticalBar || inHorizontalBar;
      const c = isAccent ? accent : bg;
      raw[px] = c[0];
      raw[px + 1] = c[1];
      raw[px + 2] = c[2];
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);

  const png = Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  fs.writeFileSync(outPath, png);
  console.log(`Wrote ${outPath} (${size}x${size})`);
}

const outDir = path.join(__dirname, "..", "public", "icons");
fs.mkdirSync(outDir, { recursive: true });
makeIcon(192, path.join(outDir, "icon-192.png"));
makeIcon(512, path.join(outDir, "icon-512.png"));
