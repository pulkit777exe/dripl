/**
 * Guards the regression that made `main` red: the maple brand asset is a
 * pre-optimized static file, and none of its usages may route back through the
 * `/_next/image` runtime optimizer.
 *
 * The failure mode was subtle. `AuthShell` marks the image `priority`, which
 * makes it a render-blocking resource. When the same static asset was pushed
 * through the optimizer, that render-blocking request intermittently never
 * responded, so the browser `load` event never fired and e2e timed out on
 * `/login` and `/signup` while `/` passed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads geometry straight out of the WebP container, so this test needs no
 * image library. `sharp` resolves transitively today but is not a declared
 * dependency of dripl-app, so importing it here would couple the suite to a
 * phantom dep.
 *
 * Container layout:
 *   "RIFF" | uint32 payload length | "WEBP" | chunks...
 *
 * For the lossy "VP8 " chunk that sharp emits for this asset, the payload is:
 *   3 bytes  frame tag
 *   3 bytes  key-frame start code (0x9d 0x01 0x2a)
 *   2 bytes  width  (14 bits, scale 1)
 *   2 bytes  height (14 bits, scale 1)
 *
 * A plain "VP8 " chunk has no alpha at all: transparency in WebP requires
 * either a VP8L stream with `alpha_is_used` set or a separate ALPH chunk, so
 * the absence of ALPH/VP8L is itself the proof the image stays opaque.
 */
function readWebpGeometry(bytes: Buffer) {
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');

  // A RIFF declares its own payload length at offset 4. It must cover
  // everything after the 8-byte header, otherwise the file is truncated.
  expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);

  const chunkType = bytes.subarray(12, 16).toString('ascii');
  expect(chunkType).toBe('VP8 ');

  const startCode = bytes.subarray(23, 26);
  expect([...startCode]).toEqual([0x9d, 0x01, 0x2a]);

  const width = bytes.readUInt16LE(26) & 0x3fff;
  const height = bytes.readUInt16LE(28) & 0x3fff;

  // No ALPH chunk anywhere in the file => the image is fully opaque, which is
  // what `mix-blend-multiply` on the landing CTA depends on.
  expect(bytes.includes(Buffer.from('ALPH', 'ascii'))).toBe(false);

  return { chunkType, width, height };
}

const APP_ROOT = join(__dirname, '..', '..');
const PUBLIC_DIR = join(APP_ROOT, 'public');

/** Every file that references the brand asset, each with its usage site. */
const USAGES = [
  { file: join(APP_ROOT, 'app', 'page.tsx'), label: 'app/page.tsx' },
  { file: join(APP_ROOT, 'components', 'auth', 'AuthShell.tsx'), label: 'AuthShell.tsx' },
  {
    file: join(APP_ROOT, 'components', 'dashboard', 'DashboardSidebar.tsx'),
    label: 'DashboardSidebar.tsx',
  },
];

describe('maple brand asset', () => {
  it('ships a pre-optimized webp and no longer ships the 1.7MB png', () => {
    const files = readdirSync(PUBLIC_DIR);

    expect(files).toContain('maple.webp');
    // The original PNG was 1,738,332 bytes. Leaving it in /public would keep a
    // dead multi-megabyte payload in the build output.
    expect(files).not.toContain('maple.png');

    const webpBytes = statSync(join(PUBLIC_DIR, 'maple.webp')).size;
    // Regression guard, not a size-optimisation target: the point is that the
    // asset is a static file, not that it is maximally compressed. WebP q85 at
    // the original 1200x800 geometry lands near 275KB.
    expect(webpBytes).toBeLessThan(400 * 1024);
    // Sanity check that the file is really WebP and not a mislabeled PNG:
    // both formats start with distinct magic bytes (RIFF....WEBP).
    const header = readFileSync(join(PUBLIC_DIR, 'maple.webp')).subarray(0, 12);
    expect(header.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(header.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it.each(USAGES)('$label points at the webp and opts out of the optimizer', ({ file }) => {
    const source = readFileSync(file, 'utf-8');

    expect(source).toContain('src="/maple.webp"');
    expect(source).not.toContain('maple.png');
    // The whole point of the fix: no render-blocking request may depend on
    // the optimizer for a pre-optimized local asset. Scoped to the maple
    // element's own attributes, since `next/image` still supports the
    // optimizer for the other (remote, user-uploaded) images in these files.
    const start = source.indexOf('src="/maple.webp"');
    // Comments live inside the JSX attributes, so scan JSX lines only.
    const mapleBlock = source
      .slice(start, source.indexOf('/>', start))
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n');
    expect(mapleBlock).toContain('unoptimized');
    expect(mapleBlock).not.toContain('_next/image');
  });

  it('AuthShell keeps its preload hint, since the hero genuinely should be preloaded', () => {
    const authShellUsage = USAGES[1]!;
    const source = readFileSync(authShellUsage.file, 'utf-8');

    expect(source).toMatch(
      /unoptimized[\s\S]*?\n\s*className="object-cover pointer-events-none"\n\s*priority/
    );
  });

  it('preserves the layout contract at every usage site', () => {
    const [page, authShell, sidebar] = USAGES.map(u => readFileSync(u.file, 'utf-8'));

    // 52vw full-bleed heroes keep their sizes + object-cover + pointer-events-none.
    for (const source of [page, authShell]) {
      expect(source).toContain('sizes="52vw"');
      expect(source).toMatch(/object-cover/);
      expect(source).toContain('pointer-events-none');
    }

    // The landing CTA keeps its blend/opacity treatment.
    expect(page).toContain('opacity-30 mix-blend-multiply pointer-events-none');

    // The sidebar icon keeps object-contain and its 32px hint, plus alt text.
    expect(sidebar).toContain('sizes="32px"');
    expect(sidebar).toContain('object-contain p-1');
    expect(sidebar).toContain('alt="Workspace icon"');

    // Decorative heroes stay alt="" so assistive tech ignores them.
    expect(page).toMatch(/src="\/maple\.webp"\n\s*alt=""/);
    expect(authShell).toMatch(/src="\/maple\.webp"\n\s*alt=""/);
  });

  it('the webp is a well-formed, opaque container at the original 3:2 geometry', () => {
    // Guards against shipping a file that compressed well but is structurally
    // broken, got truncated, or lost its dimensions. The original PNG is an
    // opaque 1200x800 RGB image on white; `mix-blend-multiply` on the landing
    // CTA relies on that white, so the image must stay opaque.
    const source = readFileSync(join(PUBLIC_DIR, 'maple.webp'));

    const { width, height } = readWebpGeometry(source);

    // Geometry survived the re-encode. The heroes use object-cover, so a
    // changed ratio would visibly shift the crop.
    expect({ width, height }).toEqual({ width: 1200, height: 800 });
    expect(width / height).toBeCloseTo(1.5, 2);
  });

  it('no source file anywhere in the app references the removed png', () => {
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (
          // This file names maple.png on purpose, to assert nothing else does.
          entry.name !== 'mapleAsset.test.ts' &&
          /\.(ts|tsx|js|jsx|css|json|webmanifest)$/.test(entry.name)
        ) {
          if (readFileSync(full, 'utf-8').includes('maple.png')) offenders.push(full);
        }
      }
    };
    walk(APP_ROOT);

    expect(offenders).toEqual([]);
  });
});
