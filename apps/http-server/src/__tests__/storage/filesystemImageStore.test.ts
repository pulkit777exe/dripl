import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createFilesystemImageStore } from '../../storage/filesystemImageStore';
import { ImageStoreError, InvalidImageKeyError, isImageKey } from '../../storage/imageStore';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const KEY = 'abcdef12-0000-4000-8000-000000000000.png';

describe('filesystem image store', () => {
  let root: string;
  let directory: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dripl-fs-store-'));
    directory = join(root, 'images');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips bytes', async () => {
    const store = createFilesystemImageStore(directory);

    await store.put(KEY, PNG, 'image/png');
    const read = await store.get(KEY);

    expect(read?.equals(PNG)).toBe(true);
  });

  it('reports absence as null rather than throwing', async () => {
    expect(await createFilesystemImageStore(directory).get('ffffffff.png')).toBeNull();
  });

  it('creates its directory on first write and not before', async () => {
    const store = createFilesystemImageStore(directory);
    expect(existsSync(directory)).toBe(false);

    await store.put(KEY, PNG, 'image/png');

    expect(existsSync(directory)).toBe(true);
    expect(await readdir(directory)).toEqual([KEY]);
  });

  it('creates a nested directory that does not exist yet', async () => {
    const nested = join(root, 'a', 'b', 'c');
    await createFilesystemImageStore(nested).put(KEY, PNG, 'image/png');
    expect(await createFilesystemImageStore(nested).get(KEY)).toEqual(PNG);
  });

  it('does not touch the filesystem at construction', async () => {
    createFilesystemImageStore(join(root, 'never-created'));
    expect(existsSync(join(root, 'never-created'))).toBe(false);
  });

  it('overwrites an existing object rather than appending to it', async () => {
    const store = createFilesystemImageStore(directory);
    await store.put(KEY, Buffer.alloc(64, 1), 'image/png');
    await store.put(KEY, Buffer.alloc(8, 2), 'image/png');

    const read = await store.get(KEY);
    expect(read).toHaveLength(8);
    expect(read?.equals(Buffer.alloc(8, 2))).toBe(true);
  });

  it('rejects a key that is not in the generated format before joining a path', async () => {
    const store = createFilesystemImageStore(directory);
    const outside = join(root, 'secret.png');
    await writeFile(outside, 'not an image');

    for (const key of [
      '../secret.png',
      '../../etc/passwd',
      'a/b.png',
      'sub/dir/x.png',
      '/etc/passwd',
      'x.png ',
      '',
    ]) {
      await expect(store.get(key)).rejects.toBeInstanceOf(InvalidImageKeyError);
      await expect(store.put(key, PNG, 'image/png')).rejects.toBeInstanceOf(InvalidImageKeyError);
    }

    // No directory was created, so nothing reached disk at all.
    expect(existsSync(directory)).toBe(false);
    expect(await readdir(root)).toEqual(['secret.png']);
  });

  it('surfaces a local I/O failure as a typed error', async () => {
    // A path whose parent is a regular file cannot be created.
    const blocked = join(root, 'file');
    await writeFile(blocked, 'x');
    const store = createFilesystemImageStore(join(blocked, 'images'));

    const error = await store.put(KEY, PNG, 'image/png').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ImageStoreError);
    expect((error as ImageStoreError).code).toBe('local_io');
    expect((error as ImageStoreError).storeKind).toBe('filesystem');
  });

  it('wraps no driver-specific text into the key validation message', async () => {
    // The route matches on this message for its 400, so it is part of the
    // response contract rather than an implementation detail.
    await expect(createFilesystemImageStore(directory).get('nope')).rejects.toThrow(
      'Invalid image id'
    );
  });
});

describe('the image key grammar', () => {
  it('accepts exactly the ids this service generates', () => {
    for (const key of [
      'abcdef12.png',
      '9f8b2c1d-0000-4000-8000-abcdefabcdef.png',
      'a.jpg',
      'a.gif',
      'a.webp',
      'A.PNG',
    ]) {
      expect(isImageKey(key)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const key of [
      '',
      'a',
      '.png',
      'a.png.txt',
      'a.txt',
      'a.png/../b.png',
      '../a.png',
      '/a.png',
      'a b.png',
      'a\u0000.png',
      'a\n.png',
      'a.png\u0000',
      'a?.png',
      'a#b.png',
      '%2e%2e%2fa.png',
      'a.svg',
    ]) {
      expect(isImageKey(key)).toBe(false);
    }
  });

  it('cannot be escaped by an absolute path', async () => {
    // The store always resolves inside its configured directory.
    const root = await mkdtemp(join(tmpdir(), 'dripl-fs-abs-'));
    try {
      const store = createFilesystemImageStore(join(root, 'images'));
      await expect(store.get(resolve('/etc/hostname'))).rejects.toBeInstanceOf(
        InvalidImageKeyError
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
