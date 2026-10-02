import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertImageKey, ImageStoreError, type ImageStore } from './imageStore';

/**
 * The default driver: a directory on the machine running http-server.
 *
 * Behaviour is deliberately identical to the code this replaced, including the
 * default directory and the lazy `mkdir`. The directory is created on the first
 * write rather than at construction, so importing this module cannot touch the
 * filesystem, and so a `process.cwd()` that is not writable at boot still
 * leaves `GET /health` working. Nothing here does I/O at construction time,
 * which is what lets the module be a plain object literal that a test can
 * create in microseconds.
 */
export function createFilesystemImageStore(directory: string): ImageStore {
  // The key is the only untrusted input that reaches `join`, and it is
  // validated here rather than trusted from the caller, so this function cannot
  // be turned into a traversal primitive by a future caller that forgot.
  const pathFor = (key: string): string => join(directory, assertImageKey(key));

  return {
    kind: 'filesystem',

    async put(key: string, body: Buffer, _contentType: string): Promise<void> {
      const filePath = pathFor(key);
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(filePath, body);
      } catch (error) {
        throw new ImageStoreError({
          code: 'local_io',
          storeKind: 'filesystem',
          message: `Failed to write image ${key}: ${describe(error)}`,
        });
      }
    },

    async get(key: string): Promise<Buffer | null> {
      const filePath = pathFor(key);
      try {
        return await readFile(filePath);
      } catch (error) {
        // Absent is a normal outcome, not a failure: the route maps it to 404.
        if (isErrnoCode(error, 'ENOENT')) return null;
        throw new ImageStoreError({
          code: 'local_io',
          storeKind: 'filesystem',
          message: `Failed to read image ${key}: ${describe(error)}`,
        });
      }
    },
  };
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
}
