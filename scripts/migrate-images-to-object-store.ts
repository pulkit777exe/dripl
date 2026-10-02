#!/usr/bin/env tsx
/**
 * Copy images from local disk into the configured object store.
 *
 * WHAT THIS IS FOR. Existing deployments keep their images under
 * `IMAGE_STORAGE_DIR` on the machine that wrote them. Setting `IMAGE_S3_BUCKET`
 * switches the image route to the S3 driver, which then reads and writes only
 * the bucket — so a deployment that flips the switch without running this first
 * serves 404 for every image it already had. This script is the migration
 * path for that.
 *
 * WHAT IT GUARANTEES.
 *   1. It never deletes a source file, and it never writes to the source
 *      directory. There is no `--delete` flag and no `rm` in this file.
 *   2. It is idempotent: a key already present in the bucket is skipped, so a
 *      re-run after a partial failure resumes rather than re-uploading, and
 *      re-running a completed migration is a no-op.
 *   3. Every object it writes is verified by reading it back and comparing the
 *      bytes. An unverified write is reported as a failure.
 *   4. It refuses to run at all when there is no destination bucket, rather
 *      than reporting success having done nothing — see "REFUSAL" below.
 *   5. It only copies files whose name is a valid image id, so a stray file in
 *      the source directory is reported and skipped rather than uploaded under
 *      a key the route could never serve.
 *
 * REFUSAL. With no `IMAGE_S3_BUCKET` set, the run stops before reading a single
 * file and exits non-zero. The dangerous outcome to avoid is a migration that
 * appears to have succeeded while having migrated nothing, so an operator who
 * believed it ran would flip the route onto an empty bucket.
 *
 * USAGE
 *   Dry run (default; reads and reports, writes nothing):
 *     pnpm exec tsx scripts/migrate-images-to-object-store.ts
 *
 *   Copy:
 *     pnpm exec tsx scripts/migrate-images-to-object-store.ts --apply
 *
 *   Override the source directory (defaults to `IMAGE_STORAGE_DIR`):
 *     pnpm exec tsx scripts/migrate-images-to-object-store.ts \
 *       --source /srv/dripl/uploads/images --apply
 *
 *   Stop after N objects, for a staged migration:
 *     pnpm exec tsx scripts/migrate-images-to-object-store.ts --limit 500 --apply
 *
 *   Load credentials from the environment first (or use a process manager's
 *   secret store; never commit them):
 *     set -a && . ./.env && set +a
 *
 * OPTIONS
 *   --apply        Perform the copy. Without it the run is a dry run.
 *   --source DIR   Source directory. Overrides `IMAGE_STORAGE_DIR`.
 *   --limit N      Copy at most N objects, then stop.
 *   --quiet        Only print the summary and any failures.
 *   --help         Print this usage.
 *
 * EXIT CODES
 *   0  Success, or a dry run that found nothing to do.
 *   1  At least one object failed to copy or verify.
 *   2  Refused: no destination bucket configured, bad options, or unreadable
 *      source directory. Nothing was written.
 *
 * NOTE ON RUNNING IT. The storage module itself is read from source through
 * tsx, but it imports the app's pino logger, and `@dripl/utils` resolves
 * through its `exports` map to `dist/`. So `@dripl/utils` must have been built
 * once (`pnpm --filter @dripl/utils build`, or any `pnpm build`). This script
 * deliberately reuses `resolveImageStoreConfig` and the drivers rather than
 * reimplementing S3 signing: a migration that wrote objects the app could not
 * read would be worse than no migration.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ImageStoreError,
  createImageStore,
  isImageKey,
  resolveImageStoreConfig,
  type ImageStore,
} from '../apps/http-server/src/storage';

interface Options {
  apply: boolean;
  source: string;
  limit: number | null;
  quiet: boolean;
}

interface Summary {
  copied: number;
  skipped: number;
  verified: number;
  rejectedNames: string[];
  failures: Array<{ key: string; reason: string }>;
}

/**
 * A CLI writes to stdout; the repository's console boundary exists so server
 * and browser code cannot leak unstructured output, and `process.stdout.write`
 * is how the other scripts here (`ensure-prisma-client.mjs`,
 * `benchmarks/canvas-performance.ts`) report progress without tripping it.
 * Everything an operator must not miss goes to stderr instead.
 */
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const USAGE = `Usage: pnpm exec tsx scripts/migrate-images-to-object-store.ts [options]

  --apply        Perform the copy. Without it the run is a dry run.
  --source DIR   Source directory. Overrides IMAGE_STORAGE_DIR.
  --limit N      Copy at most N objects, then stop.
  --quiet        Only print the summary and any failures.
  --help         Print this usage.

Exit codes: 0 success, 1 some objects failed, 2 refused (nothing written).`;

function parseArgs(argv: string[]): Options | 'help' {
  let apply = false;
  let source = '';
  let limit: number | null = null;
  let quiet = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    switch (arg) {
      case '--apply':
        apply = true;
        break;
      case '--source': {
        const value = argv[++index];
        if (!value) throw new Error('--source requires a directory');
        source = value;
        break;
      }
      case '--limit': {
        const value = argv[++index];
        const parsed = Number(value);
        if (!value || !Number.isInteger(parsed) || parsed < 1) {
          throw new Error('--limit requires a positive integer');
        }
        limit = parsed;
        break;
      }
      case '--quiet':
        quiet = true;
        break;
      case '--help':
      case '-h':
        return 'help';
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  return { apply, source, limit, quiet };
}

function contentTypeFor(key: string): string {
  const extension = key.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      // Unreachable: `isImageKey` has already constrained the extension.
      return 'application/octet-stream';
  }
}

/**
 * Copy one object, then read it back and compare.
 *
 * The read-back is the point. A `PUT` that returns 200 has only promised that
 * the store accepted the request; comparing the bytes is what turns that into
 * evidence the image the app will later serve is the image that was on disk.
 */
async function copyOne(
  store: ImageStore,
  key: string,
  bytes: Buffer
): Promise<'copied' | 'verified'> {
  const existing = await store.get(key);
  if (existing !== null) {
    // Idempotence: present is treated as done. Re-uploading identical bytes
    // would be harmless but would rewrite every object on every re-run, and
    // would defeat the purpose of resuming an interrupted run.
    return 'verified';
  }
  await store.put(key, bytes, contentTypeFor(key));

  const readBack = await store.get(key);
  if (readBack === null) {
    throw new Error('object is absent immediately after a successful write');
  }
  if (!readBack.equals(bytes)) {
    throw new Error(
      `read-back differs from the source (${readBack.length} bytes back, ${bytes.length} sent)`
    );
  }
  return 'copied';
}

async function run(options: Options): Promise<number> {
  // Resolve the destination first. If this throws there is nothing to migrate
  // into, so the run is refused before the source directory is even opened.
  const config = resolveImageStoreConfig();
  if (config.kind !== 's3') {
    console.error(
      'Refusing to run: no destination bucket is configured.\n' +
        '  Set IMAGE_S3_BUCKET (and credentials) to migrate into, or unset it to\n' +
        '  keep serving images from local disk.\n' +
        '  Nothing was read, copied or deleted.'
    );
    return 2;
  }

  // The source is the directory the filesystem driver used, which is the same
  // variable, so an operator only has to know one setting.
  const sourceDir =
    options.source || process.env.IMAGE_STORAGE_DIR || join(process.cwd(), 'uploads', 'images');

  let entries: string[];
  try {
    const dirStat = await stat(sourceDir);
    if (!dirStat.isDirectory()) {
      console.error(`Refusing to run: ${sourceDir} is not a directory.`);
      return 2;
    }
    entries = await readdir(sourceDir);
  } catch (error) {
    console.error(
      `Refusing to run: cannot read source directory ${sourceDir}: ` +
        `${error instanceof Error ? error.message : String(error)}\n` +
        '  Nothing was written.'
    );
    return 2;
  }

  const store = createImageStore(config);

  const summary: Summary = {
    copied: 0,
    skipped: 0,
    verified: 0,
    rejectedNames: [],
    failures: [],
  };

  const candidates = entries.filter(entry => {
    if (!isImageKey(entry)) {
      summary.rejectedNames.push(entry);
      return false;
    }
    return true;
  });
  const selected = options.limit === null ? candidates : candidates.slice(0, options.limit);

  if (!options.quiet) {
    out(
      `${options.apply ? 'Migrating' : 'Would migrate'} ${selected.length} image(s) from ` +
        `${sourceDir} to s3://${config.bucket} at ${config.endpoint}` +
        (options.limit === null ? '' : ` (limit ${options.limit})`)
    );
    if (!options.apply) {
      out('Dry run. Re-run with --apply to copy.');
    }
  }

  for (const key of selected) {
    if (!options.apply) {
      // A dry run still proves the source is readable and the name is valid.
      try {
        const bytes = await readFile(join(sourceDir, key));
        summary.skipped++;
        if (!options.quiet) {
          out(`  would copy ${key} (${bytes.length} bytes)`);
        }
      } catch (error) {
        summary.failures.push({
          key,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }

    try {
      const bytes = await readFile(join(sourceDir, key));
      const result = await copyOne(store, key, bytes);
      summary[result]++;
      if (!options.quiet) {
        out(`  ${result === 'copied' ? 'copied  ' : 'present '} ${key} (${bytes.length} bytes)`);
      }
    } catch (error) {
      summary.failures.push({
        key,
        reason: error instanceof ImageStoreError ? error.message : String(error),
      });
      if (!options.quiet) {
        console.error(`  FAILED   ${key}: ${summary.failures.at(-1)!.reason}`);
      }
    }
  }

  if (!options.quiet && options.apply) {
    out(
      `Done. copied=${summary.copied} already-present=${summary.verified} ` +
        `failed=${summary.failures.length}`
    );
  }
  if (summary.rejectedNames.length > 0) {
    process.stderr.write(
      `Skipped ${summary.rejectedNames.length} file(s) whose name is not a valid image id: ` +
        `${summary.rejectedNames.slice(0, 10).join(', ')}` +
        (summary.rejectedNames.length > 10 ? ', ...' : '') +
        '\n'
    );
  }
  if (summary.failures.length > 0) {
    console.error(`Failed to migrate ${summary.failures.length} object(s). Sources are untouched.`);
    return 1;
  }
  return 0;
}

async function main(): Promise<void> {
  let options: Options;
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed === 'help') {
      out(USAGE);
      return;
    }
    options = parsed;
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    process.exit(2);
  }

  try {
    process.exit(await run(options));
  } catch (error) {
    console.error(
      `Migration aborted: ${error instanceof Error ? error.message : String(error)}. ` +
        'No source file was deleted.'
    );
    process.exit(2);
  }
}

void main();
