import { deflateSync, inflateSync } from 'node:zlib';
import type { Surface } from './raster';

/**
 * A minimal PNG reader/writer, so pixel evidence exists as an image.
 *
 * WHY
 * ---
 * A programmatic diff is the primary signal, but "0 differing pixels of
 * 921,600" is a claim about numbers. Being able to look at the frame — and at a
 * magnified crop of the region a change landed in — is what turns the number into
 * something checkable. Node ships zlib, so a real PNG costs about sixty lines
 * here and no dependency.
 *
 * `decodePng` exists for the round-trip check: writing a surface and reading it
 * back byte-for-byte is what shows the encoder is faithful rather than merely
 * plausible.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

export function encodePng(surface: Surface): Buffer {
  const { width, height, data } = surface;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row += 1) {
    const start = row * (width * 4 + 1);
    raw[start] = 0;
    Buffer.from(data.buffer, data.byteOffset + row * width * 4, width * 4).copy(raw, start + 1);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function decodePng(buffer: Buffer): Surface {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('png: bad signature');
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    const expected = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== expected) {
      throw new Error(`png: CRC mismatch in ${type}`);
    }
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6) throw new Error('png: expected 8-bit RGBA');
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body));
    }
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * stride] as number;
    if (filter !== 0) throw new Error(`png: unsupported row filter ${filter}`);
    raw.copy(
      Buffer.from(data.buffer, data.byteOffset, data.length),
      row * width * 4,
      row * stride + 1,
      row * stride + 1 + width * 4
    );
  }
  return { width, height, data };
}

/**
 * Nearest-neighbour crop, magnified by an integer factor, on a white
 * background — so an element at 27x19 device pixels is legible rather than a
 * smudge.
 */
export function cropMagnified(
  surface: Surface,
  x: number,
  y: number,
  w: number,
  h: number,
  zoom: number
): Surface {
  const out = new Uint8ClampedArray(w * zoom * h * zoom * 4);
  for (let row = 0; row < h * zoom; row += 1) {
    for (let column = 0; column < w * zoom; column += 1) {
      const sourceX = Math.min(surface.width - 1, Math.max(0, x + Math.floor(column / zoom)));
      const sourceY = Math.min(surface.height - 1, Math.max(0, y + Math.floor(row / zoom)));
      const from = (sourceY * surface.width + sourceX) * 4;
      const to = (row * w * zoom + column) * 4;
      const alpha = (surface.data[from + 3] as number) / 255;
      // Composite over white: an unfilled pixel in a canvas screenshot is white.
      for (let channel = 0; channel < 3; channel += 1) {
        const value = surface.data[from + channel] as number;
        out[to + channel] = Math.round(value * alpha + 255 * (1 - alpha));
      }
      out[to + 3] = 255;
    }
  }
  return { width: w * zoom, height: h * zoom, data: out };
}
