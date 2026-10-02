import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import {
  DEFAULT_S3_REGION,
  DEFAULT_S3_REQUEST_TIMEOUT_MS,
  createImageStore,
  describeImageStoreConfig,
  getImageStore,
  resetImageStoreLogStateForTests,
  resolveImageStoreConfig,
  type ImageStoreConfig,
} from '../../storage';
import { ImageStoreError } from '../../storage/imageStore';
import { logger } from '../../logger';

const ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';

const FULL_S3_ENV = {
  IMAGE_S3_BUCKET: 'dripl-images',
  IMAGE_S3_ACCESS_KEY_ID: ACCESS_KEY,
  IMAGE_S3_SECRET_ACCESS_KEY: SECRET,
} satisfies NodeJS.ProcessEnv;

function expectNotConfigured(fn: () => unknown, variable: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ImageStoreError);
    const storeError = error as ImageStoreError;
    expect(storeError.code).toBe('not_configured');
    // The message names the variable. It must never contain its value.
    expect(storeError.message).toContain(variable);
    return;
  }
  throw new Error(`expected ${variable} to be rejected`);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetImageStoreLogStateForTests();
});

describe('resolveImageStoreConfig — the default path', () => {
  it('is the filesystem with the historical default directory', () => {
    const config = resolveImageStoreConfig({});

    expect(config.kind).toBe('filesystem');
    expect(config).toEqual({
      kind: 'filesystem',
      directory: join(process.cwd(), 'uploads', 'images'),
    });
  });

  it('honours IMAGE_STORAGE_DIR exactly as before', () => {
    const config = resolveImageStoreConfig({ IMAGE_STORAGE_DIR: '/srv/images' });
    expect(config).toEqual({ kind: 'filesystem', directory: '/srv/images' });
  });

  it('treats an empty IMAGE_STORAGE_DIR as unset rather than as the root', () => {
    const config = resolveImageStoreConfig({ IMAGE_STORAGE_DIR: '   ' });
    expect(config).toEqual({
      kind: 'filesystem',
      directory: join(process.cwd(), 'uploads', 'images'),
    });
  });

  it('needs no object-storage variable at all', () => {
    // The regression this whole change could have introduced: a deployment
    // that has never heard of S3 must not have to configure anything.
    expect(() => resolveImageStoreConfig({})).not.toThrow();
    expect(createImageStore(resolveImageStoreConfig({})).kind).toBe('filesystem');
  });

  it('ignores object-storage variables that do not include a bucket', () => {
    const config = resolveImageStoreConfig({
      IMAGE_S3_REGION: 'eu-west-1',
      IMAGE_S3_ENDPOINT: 'https://example.invalid',
      IMAGE_S3_ACCESS_KEY_ID: ACCESS_KEY,
    });

    expect(config.kind).toBe('filesystem');
  });
});

describe('resolveImageStoreConfig — object storage', () => {
  it('selects S3 when a bucket is set', () => {
    const config = resolveImageStoreConfig(FULL_S3_ENV);

    expect(config).toEqual({
      kind: 's3',
      bucket: 'dripl-images',
      region: DEFAULT_S3_REGION,
      endpoint: 'https://s3.us-east-1.amazonaws.com',
      forcePathStyle: true,
      credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET },
      requestTimeoutMs: DEFAULT_S3_REQUEST_TIMEOUT_MS,
    });
  });

  it('derives the AWS endpoint from the region when none is given', () => {
    const config = resolveImageStoreConfig({ ...FULL_S3_ENV, IMAGE_S3_REGION: 'ap-south-1' });
    expect(config).toMatchObject({
      region: 'ap-south-1',
      endpoint: 'https://s3.ap-south-1.amazonaws.com',
    });
  });

  it('accepts an endpoint as a bare host and adds a scheme', () => {
    const config = resolveImageStoreConfig({
      ...FULL_S3_ENV,
      IMAGE_S3_ENDPOINT: 's3.us-west-004.backblazeb2.com',
    });
    expect(config).toMatchObject({ endpoint: 'https://s3.us-west-004.backblazeb2.com' });
  });

  it('keeps an explicit scheme and port, which MinIO needs', () => {
    const config = resolveImageStoreConfig({
      ...FULL_S3_ENV,
      IMAGE_S3_ENDPOINT: 'http://127.0.0.1:9000',
      IMAGE_S3_REGION: 'us-east-1',
    });
    expect(config).toMatchObject({ endpoint: 'http://127.0.0.1:9000' });
  });

  it('accepts an endpoint with a trailing slash', () => {
    const config = resolveImageStoreConfig({
      ...FULL_S3_ENV,
      IMAGE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
    });
    expect(config).toMatchObject({ endpoint: 'https://acct.r2.cloudflarestorage.com' });
  });

  it('parses the addressing style and the timeout', () => {
    expect(resolveImageStoreConfig({ ...FULL_S3_ENV, IMAGE_S3_PATH_STYLE: 'false' })).toMatchObject(
      { forcePathStyle: false }
    );
    expect(resolveImageStoreConfig({ ...FULL_S3_ENV, IMAGE_S3_PATH_STYLE: 'no' })).toMatchObject({
      forcePathStyle: false,
    });
    expect(resolveImageStoreConfig({ ...FULL_S3_ENV, IMAGE_S3_TIMEOUT_MS: '3000' })).toMatchObject({
      requestTimeoutMs: 3000,
    });
  });

  it('carries a session token when one is configured', () => {
    const config = resolveImageStoreConfig({
      ...FULL_S3_ENV,
      IMAGE_S3_SESSION_TOKEN: 'temporary-token',
    });
    expect(config).toMatchObject({
      credentials: { sessionToken: 'temporary-token' },
    });
  });
});

describe('resolveImageStoreConfig — misconfiguration is refused, loudly and safely', () => {
  it('refuses a bucket without credentials', () => {
    expectNotConfigured(
      () => resolveImageStoreConfig({ IMAGE_S3_BUCKET: 'dripl-images' }),
      'IMAGE_S3_ACCESS_KEY_ID'
    );
    expectNotConfigured(
      () =>
        resolveImageStoreConfig({
          IMAGE_S3_BUCKET: 'dripl-images',
          IMAGE_S3_ACCESS_KEY_ID: ACCESS_KEY,
        }),
      'IMAGE_S3_SECRET_ACCESS_KEY'
    );
  });

  it('refuses a bucket name that could escape its path prefix or add a URL part', () => {
    // The bucket is spliced into a URL, so these are the shapes that would put
    // a path escape, a query, a fragment or userinfo into a signed request.
    for (const bucket of [
      'bucket/../other',
      'bucket?x=1',
      'bucket#frag',
      'UPPERCASE',
      'under_score',
      'has space',
      'bu\ncket',
      'bu\rcket',
      'a',
      `${'a'.repeat(64)}`,
      'bucket@evil.example.com',
      '//evil.example.com/bucket',
      'bucket:9000',
      '../evil',
    ]) {
      expectNotConfigured(
        () => resolveImageStoreConfig({ ...FULL_S3_ENV, IMAGE_S3_BUCKET: bucket }),
        'IMAGE_S3_BUCKET'
      );
    }
  });

  it('accepts a bucket name that merely looks like a hostname, which cannot redirect', () => {
    // The request host comes from IMAGE_S3_ENDPOINT alone, so a hostname-shaped
    // bucket is a label, not a destination.
    expect(resolveImageStoreConfig({ ...FULL_S3_ENV, IMAGE_S3_BUCKET: 'a.b.example' }).kind).toBe(
      's3'
    );
  });

  it('refuses an endpoint that is not a bare origin', () => {
    for (const endpoint of [
      'https://user:pass@evil.example.com',
      'https://s3.example.com/bucket',
      'https://s3.example.com/?x=1',
      'ftp://s3.example.com',
      'file:///etc/passwd',
      'not a host',
    ]) {
      expectNotConfigured(
        () => resolveImageStoreConfig({ ...FULL_S3_ENV, IMAGE_S3_ENDPOINT: endpoint }),
        'IMAGE_S3_ENDPOINT'
      );
    }
  });

  it('refuses unparseable booleans and timeouts', () => {
    expectNotConfigured(
      () => resolveImageStoreConfig({ ...FULL_S3_ENV, IMAGE_S3_PATH_STYLE: 'maybe' }),
      'IMAGE_S3_PATH_STYLE'
    );
    expectNotConfigured(
      () => resolveImageStoreConfig({ ...FULL_S3_ENV, IMAGE_S3_TIMEOUT_MS: '-1' }),
      'IMAGE_S3_TIMEOUT_MS'
    );
  });

  it('never puts a credential value into a misconfiguration message', () => {
    try {
      resolveImageStoreConfig({ ...FULL_S3_ENV, IMAGE_S3_BUCKET: 'bucket@evil.example.com' });
      throw new Error('expected rejection');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain(ACCESS_KEY);
    }
  });
});

describe('describeImageStoreConfig — the loggable view', () => {
  it('carries no credential field to leak', () => {
    const s3 = describeImageStoreConfig(resolveImageStoreConfig(FULL_S3_ENV));
    expect(s3).toEqual({
      kind: 's3',
      bucket: 'dripl-images',
      region: 'us-east-1',
      endpoint: 'https://s3.us-east-1.amazonaws.com',
      forcePathStyle: true,
    });
    expect(JSON.stringify(s3)).not.toContain(SECRET);
    expect(JSON.stringify(s3)).not.toContain(ACCESS_KEY);
  });

  it('describes the filesystem driver too', () => {
    expect(describeImageStoreConfig({ kind: 'filesystem', directory: '/srv/i' })).toEqual({
      kind: 'filesystem',
      directory: '/srv/i',
    });
  });

  it('cannot be coerced into exposing credentials, because the type has no such field', () => {
    // A structural assertion: adding a `credentials` key to the description is
    // a type error, so this test fails to compile rather than passing quietly.
    expect(
      Object.keys(describeImageStoreConfig(resolveImageStoreConfig(FULL_S3_ENV)))
    ).not.toContain('credentials');
  });
});

describe('getImageStore — construction is cheap, late, and logged', () => {
  it('resolves a filesystem store with no object-storage configuration', () => {
    vi.stubEnv('IMAGE_STORAGE_DIR', '/srv/default-images');
    vi.stubEnv('IMAGE_S3_BUCKET', '');
    const store = getImageStore();
    expect(store.kind).toBe('filesystem');
  });

  it('logs the active configuration without any credential', () => {
    vi.stubEnv('IMAGE_S3_BUCKET', 'dripl-images');
    vi.stubEnv('IMAGE_S3_ACCESS_KEY_ID', ACCESS_KEY);
    vi.stubEnv('IMAGE_S3_SECRET_ACCESS_KEY', SECRET);
    vi.stubEnv('IMAGE_S3_SESSION_TOKEN', 'temporary-token');

    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    getImageStore();

    const records = info.mock.calls.map(([record]) => JSON.stringify(record)).join('\n');
    expect(records).toContain('image_store_configured');
    expect(records).toContain('dripl-images');
    expect(records).not.toContain(SECRET);
    expect(records).not.toContain(ACCESS_KEY);
    expect(records).not.toContain('temporary-token');
  });

  it('does not re-log the same configuration on every request', () => {
    vi.stubEnv('IMAGE_STORAGE_DIR', '/srv/log-once');
    vi.stubEnv('IMAGE_S3_BUCKET', '');
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});

    getImageStore();
    getImageStore();
    getImageStore();

    expect(info).toHaveBeenCalledTimes(1);
  });

  it('throws at first use on a misconfigured bucket, without touching the network', () => {
    vi.stubEnv('IMAGE_S3_BUCKET', 'dripl-images?x=1');
    vi.stubEnv('IMAGE_S3_ACCESS_KEY_ID', ACCESS_KEY);
    vi.stubEnv('IMAGE_S3_SECRET_ACCESS_KEY', SECRET);
    vi.stubEnv('IMAGE_S3_ENDPOINT', 'https://s3.eu-west-1.amazonaws.com');

    expect(() => getImageStore()).toThrow(ImageStoreError);
  });

  it('throws at first use on missing credentials, without touching the network', () => {
    vi.stubEnv('IMAGE_S3_BUCKET', 'dripl-images');
    vi.stubEnv('IMAGE_S3_ACCESS_KEY_ID', '');
    vi.stubEnv('IMAGE_S3_SECRET_ACCESS_KEY', '');

    expect(() => getImageStore()).toThrow(ImageStoreError);
  });
});

describe('createImageStore', () => {
  it('produces the driver the config names', () => {
    const config: ImageStoreConfig = resolveImageStoreConfig({ IMAGE_STORAGE_DIR: '/srv/x' });
    expect(createImageStore(config).kind).toBe('filesystem');
    expect(createImageStore(resolveImageStoreConfig(FULL_S3_ENV)).kind).toBe('s3');
  });

  it('re-checks the bucket name at construction, for a hand-built config', () => {
    // `createImageStore` is exported and callable with a config object that did
    // not come from `resolveImageStoreConfig`, so the URL-safety check has to be
    // at the point of construction too rather than only at the env boundary.
    const config = {
      kind: 's3',
      bucket: 'bucket@evil.example.com',
      region: 'us-east-1',
      endpoint: 'https://s3.amazonaws.com',
      forcePathStyle: true,
      credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET },
      requestTimeoutMs: 1000,
    } satisfies ImageStoreConfig;

    expect(() => createImageStore(config)).toThrow(ImageStoreError);
  });
});
