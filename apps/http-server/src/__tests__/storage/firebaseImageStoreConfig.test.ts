import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  DEFAULT_FIREBASE_ENDPOINT,
  DEFAULT_FIREBASE_REQUEST_TIMEOUT_MS,
  DEFAULT_S3_REGION,
  createImageStore,
  describeImageStoreConfig,
  getImageStore,
  resetImageStoreLogStateForTests,
  resolveImageStoreConfig,
  type ImageStoreConfig,
} from '../../storage';
import { ImageStoreError } from '../../storage/imageStore';
import { logger } from '../../logger';

/**
 * Firebase through the env contract: which variable switches it on, what it
 * refuses, and what `describeImageStoreConfig` is allowed to say.
 *
 * No credentials and no network. The private key is a real RSA key generated
 * in-process — the driver parses it at construction, so a fake one would make
 * the "accepts a real PEM" case pass for the wrong reason — and every store
 * built here gets a stub signer, so nothing reaches `oauth2.googleapis.com`.
 */
const { privateKey: generatedKeyObject } = generateKeyPairSync('rsa', { modulusLength: 2048 });
/** Trimmed, because `normalizeFirebasePrivateKey` trims — see the sibling test. */
const PRIVATE_KEY_PEM = generatedKeyObject
  .export({ type: 'pkcs8', format: 'pem' })
  .toString()
  .trim();
const CLIENT_EMAIL = 'dripl-images@dripl-staging.iam.gserviceaccount.com';

const FULL_FIREBASE_ENV = {
  IMAGE_FIREBASE_BUCKET: 'dripl-images.appspot.com',
  IMAGE_FIREBASE_CLIENT_EMAIL: CLIENT_EMAIL,
  IMAGE_FIREBASE_PRIVATE_KEY: PRIVATE_KEY_PEM,
} satisfies NodeJS.ProcessEnv;

const S3_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const S3_SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';

function expectNotConfigured(fn: () => unknown, variable: string): ImageStoreError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ImageStoreError);
    const storeError = error as ImageStoreError;
    expect(storeError.code).toBe('not_configured');
    // The message names the variable. It must never contain its value.
    expect(storeError.message).toContain(variable);
    return storeError;
  }
  throw new Error(`expected ${variable} to be rejected`);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetImageStoreLogStateForTests();
});

describe('resolveImageStoreConfig — firebase is selected by its bucket', () => {
  it('produces the firebase config with the documented defaults', () => {
    const config = resolveImageStoreConfig(FULL_FIREBASE_ENV);

    expect(config).toEqual({
      kind: 'firebase',
      bucket: 'dripl-images.appspot.com',
      endpoint: DEFAULT_FIREBASE_ENDPOINT,
      prefix: 'images',
      serviceAccount: { clientEmail: CLIENT_EMAIL, privateKey: PRIVATE_KEY_PEM },
      requestTimeoutMs: DEFAULT_FIREBASE_REQUEST_TIMEOUT_MS,
    });
  });

  it('is ignored when the bucket is unset, so the filesystem default is untouched', () => {
    // The regression a third driver could have introduced: a deployment that
    // has never heard of Firebase must configure nothing and change nothing.
    const config = resolveImageStoreConfig({
      IMAGE_FIREBASE_CLIENT_EMAIL: CLIENT_EMAIL,
      IMAGE_FIREBASE_PRIVATE_KEY: PRIVATE_KEY_PEM,
      IMAGE_FIREBASE_PREFIX: 'images',
    });

    expect(config.kind).toBe('filesystem');
  });

  it('treats an empty bucket as unset', () => {
    expect(
      resolveImageStoreConfig({ ...FULL_FIREBASE_ENV, IMAGE_FIREBASE_BUCKET: '  ' }).kind
    ).toBe('filesystem');
  });

  it('accepts a custom prefix, endpoint and timeout', () => {
    const config = resolveImageStoreConfig({
      ...FULL_FIREBASE_ENV,
      IMAGE_FIREBASE_PREFIX: 'tenants/acme',
      IMAGE_FIREBASE_ENDPOINT: 'http://127.0.0.1:9199',
      IMAGE_FIREBASE_TIMEOUT_MS: '3000',
    });

    expect(config).toMatchObject({
      prefix: 'tenants/acme',
      // The Firebase Storage emulator runs on http, so http must be accepted.
      endpoint: 'http://127.0.0.1:9199',
      requestTimeoutMs: 3000,
    });
  });

  it('adds a scheme to a bare host, like the S3 path does', () => {
    const config = resolveImageStoreConfig({
      ...FULL_FIREBASE_ENV,
      IMAGE_FIREBASE_ENDPOINT: 'firebasestorage.example.co.uk',
    });

    expect(config).toMatchObject({ endpoint: 'https://firebasestorage.example.co.uk' });
  });

  it('unwraps the JSON escaping that service-account JSON puts in the key', () => {
    const escaped = JSON.stringify(PRIVATE_KEY_PEM).slice(1, -1);
    const config = resolveImageStoreConfig({
      ...FULL_FIREBASE_ENV,
      IMAGE_FIREBASE_PRIVATE_KEY: escaped,
    });

    expect(config).toMatchObject({ serviceAccount: { privateKey: PRIVATE_KEY_PEM } });
  });
});

describe('resolveImageStoreConfig — exactly one object store, or none', () => {
  it('refuses a configuration with both buckets set', () => {
    // A deployment migrating sets the new bucket first and clears the old one
    // second. A silent precedence rule would spend that window writing images
    // to the bucket the operator is leaving, and the only symptom would be a
    // 404 on an object a PUT reported success for.
    const error = expectNotConfigured(
      () =>
        resolveImageStoreConfig({
          ...FULL_FIREBASE_ENV,
          IMAGE_S3_BUCKET: 'dripl-images',
          IMAGE_S3_ACCESS_KEY_ID: S3_ACCESS_KEY,
          IMAGE_S3_SECRET_ACCESS_KEY: S3_SECRET,
        }),
      'IMAGE_S3_BUCKET / IMAGE_FIREBASE_BUCKET'
    );

    expect(error.message).toContain('both set');
  });

  it('still prefers S3 when only it is configured', () => {
    const config = resolveImageStoreConfig({
      IMAGE_S3_BUCKET: 'dripl-images',
      IMAGE_S3_ACCESS_KEY_ID: S3_ACCESS_KEY,
      IMAGE_S3_SECRET_ACCESS_KEY: S3_SECRET,
    });

    expect(config).toMatchObject({ kind: 's3', region: DEFAULT_S3_REGION });
  });
});

describe('resolveImageStoreConfig — misconfiguration is refused, loudly and safely', () => {
  it('refuses a firebase bucket without a service account', () => {
    expectNotConfigured(
      () => resolveImageStoreConfig({ IMAGE_FIREBASE_BUCKET: 'dripl-images.appspot.com' }),
      'IMAGE_FIREBASE_CLIENT_EMAIL'
    );
    expectNotConfigured(
      () =>
        resolveImageStoreConfig({
          IMAGE_FIREBASE_BUCKET: 'dripl-images.appspot.com',
          IMAGE_FIREBASE_CLIENT_EMAIL: CLIENT_EMAIL,
        }),
      'IMAGE_FIREBASE_PRIVATE_KEY'
    );
  });

  it('tags a firebase misconfiguration as firebase, not s3', () => {
    // Getting this wrong sends an operator to the wrong half of `.env.example`
    // while holding the problem.
    const error = expectNotConfigured(
      () => resolveImageStoreConfig({ IMAGE_FIREBASE_BUCKET: 'dripl-images.appspot.com' }),
      'IMAGE_FIREBASE_CLIENT_EMAIL'
    );

    expect(error.storeKind).toBe('firebase');
  });

  it('refuses a bucket name that could escape its prefix or add a URL part', () => {
    for (const bucket of [
      'bucket/../other',
      'bucket?x=1',
      'bucket#frag',
      'UPPERCASE',
      'under_score',
      'has space',
      'bucket@evil.example.com',
      '//evil.example.com/bucket',
      '../evil',
      'a',
    ]) {
      expectNotConfigured(
        () => resolveImageStoreConfig({ ...FULL_FIREBASE_ENV, IMAGE_FIREBASE_BUCKET: bucket }),
        'IMAGE_FIREBASE_BUCKET'
      );
    }
  });

  it('accepts a hostname-shaped bucket, which cannot redirect a request', () => {
    expect(
      resolveImageStoreConfig({ ...FULL_FIREBASE_ENV, IMAGE_FIREBASE_BUCKET: 'a.b.example' }).kind
    ).toBe('firebase');
  });

  it('refuses an endpoint that is not a bare origin', () => {
    for (const endpoint of [
      'https://user:pass@evil.example.com',
      'https://storage.example.com/bucket',
      'https://storage.example.com/?x=1',
      'ftp://storage.example.com',
      'not a host',
    ]) {
      expectNotConfigured(
        () => resolveImageStoreConfig({ ...FULL_FIREBASE_ENV, IMAGE_FIREBASE_ENDPOINT: endpoint }),
        'IMAGE_FIREBASE_ENDPOINT'
      );
    }
  });

  it('refuses an unparseable timeout', () => {
    expectNotConfigured(
      () => resolveImageStoreConfig({ ...FULL_FIREBASE_ENV, IMAGE_FIREBASE_TIMEOUT_MS: '-1' }),
      'IMAGE_FIREBASE_TIMEOUT_MS'
    );
    expectNotConfigured(
      () => resolveImageStoreConfig({ ...FULL_FIREBASE_ENV, IMAGE_FIREBASE_TIMEOUT_MS: 'soon' }),
      'IMAGE_FIREBASE_TIMEOUT_MS'
    );
  });

  it('refuses a prefix that could write outside the namespace', () => {
    // Not a traversal — the whole object name is percent-encoded — but a
    // `..` segment would be faithfully written, putting images outside the
    // prefix the operator believed they had confined them to.
    for (const prefix of [
      '../admin',
      'images/../admin',
      'images//admin',
      '/images',
      'images/',
      'images/../',
      '..',
      '.',
      'images with space',
      'images\u0000',
    ]) {
      expectNotConfigured(
        () => resolveImageStoreConfig({ ...FULL_FIREBASE_ENV, IMAGE_FIREBASE_PREFIX: prefix }),
        'IMAGE_FIREBASE_PREFIX'
      );
    }
  });

  it('accepts the prefixes a real deployment would use', () => {
    for (const prefix of ['images', 'i', 'tenants/acme/images', 'a-b.c_d/2026']) {
      expect(
        resolveImageStoreConfig({ ...FULL_FIREBASE_ENV, IMAGE_FIREBASE_PREFIX: prefix })
      ).toMatchObject({ prefix });
    }
  });

  it('never puts a credential value into a misconfiguration message', () => {
    try {
      resolveImageStoreConfig({
        IMAGE_FIREBASE_BUCKET: 'dripl-images.appspot.com',
        IMAGE_FIREBASE_CLIENT_EMAIL: CLIENT_EMAIL,
        IMAGE_FIREBASE_PRIVATE_KEY: PRIVATE_KEY_PEM,
        IMAGE_FIREBASE_PREFIX: '../escape',
      });
      throw new Error('expected rejection');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(PRIVATE_KEY_PEM);
      expect(message).not.toContain('BEGIN PRIVATE KEY');
    }
  });
});

describe('describeImageStoreConfig — the loggable view', () => {
  it('describes firebase without the private key', () => {
    const described = describeImageStoreConfig(resolveImageStoreConfig(FULL_FIREBASE_ENV));

    expect(described).toEqual({
      kind: 'firebase',
      bucket: 'dripl-images.appspot.com',
      endpoint: DEFAULT_FIREBASE_ENDPOINT,
      prefix: 'images',
      // The identifier is a deliberate inclusion: it answers whose credentials
      // are in use, which is the first question during a storage outage.
      clientEmail: CLIENT_EMAIL,
    });
    expect(JSON.stringify(described)).not.toContain(PRIVATE_KEY_PEM);
    expect(JSON.stringify(described)).not.toContain('BEGIN PRIVATE KEY');
  });

  it('has no field a private key could be put into', () => {
    // A structural assertion: adding one is an excess-property compile error,
    // so this fails to compile rather than passing quietly.
    expect(
      Object.keys(describeImageStoreConfig(resolveImageStoreConfig(FULL_FIREBASE_ENV)))
    ).not.toContain('privateKey');
  });

  it('describes the other two drivers unchanged', () => {
    expect(describeImageStoreConfig({ kind: 'filesystem', directory: '/srv/i' })).toEqual({
      kind: 'filesystem',
      directory: '/srv/i',
    });
    expect(
      describeImageStoreConfig({
        kind: 's3',
        bucket: 'b',
        region: 'us-east-1',
        endpoint: 'https://s3.amazonaws.com',
        forcePathStyle: true,
        credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET },
        requestTimeoutMs: 1000,
      })
    ).toEqual({
      kind: 's3',
      bucket: 'b',
      region: 'us-east-1',
      endpoint: 'https://s3.amazonaws.com',
      forcePathStyle: true,
    });
  });
});

describe('getImageStore — firebase construction is cheap, late, and logged', () => {
  it('builds a firebase store without touching the network', () => {
    vi.stubEnv('IMAGE_FIREBASE_BUCKET', 'dripl-images.appspot.com');
    vi.stubEnv('IMAGE_FIREBASE_CLIENT_EMAIL', CLIENT_EMAIL);
    vi.stubEnv('IMAGE_FIREBASE_PRIVATE_KEY', PRIVATE_KEY_PEM);

    expect(getImageStore().kind).toBe('firebase');
  });

  it('logs the active configuration without the private key', () => {
    vi.stubEnv('IMAGE_FIREBASE_BUCKET', 'dripl-images.appspot.com');
    vi.stubEnv('IMAGE_FIREBASE_CLIENT_EMAIL', CLIENT_EMAIL);
    vi.stubEnv('IMAGE_FIREBASE_PRIVATE_KEY', PRIVATE_KEY_PEM);

    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    getImageStore();

    const records = info.mock.calls.map(([record]) => JSON.stringify(record)).join('\n');
    expect(records).toContain('image_store_configured');
    expect(records).toContain('dripl-images.appspot.com');
    expect(records).toContain(CLIENT_EMAIL);
    expect(records).not.toContain(PRIVATE_KEY_PEM);
    expect(records).not.toContain('BEGIN PRIVATE KEY');
  });

  it('does not re-log the same configuration on every request', () => {
    vi.stubEnv('IMAGE_FIREBASE_BUCKET', 'dripl-images.appspot.com');
    vi.stubEnv('IMAGE_FIREBASE_CLIENT_EMAIL', CLIENT_EMAIL);
    vi.stubEnv('IMAGE_FIREBASE_PRIVATE_KEY', PRIVATE_KEY_PEM);

    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    getImageStore();
    getImageStore();
    getImageStore();

    expect(info).toHaveBeenCalledTimes(1);
  });

  it('throws at first use on a mangled private key, without touching the network', () => {
    vi.stubEnv('IMAGE_FIREBASE_BUCKET', 'dripl-images.appspot.com');
    vi.stubEnv('IMAGE_FIREBASE_CLIENT_EMAIL', CLIENT_EMAIL);
    vi.stubEnv('IMAGE_FIREBASE_PRIVATE_KEY', 'definitely not a pem');

    expect(() => getImageStore()).toThrow(ImageStoreError);
  });
});

describe('createImageStore', () => {
  it('produces the driver the firebase config names', () => {
    const config = resolveImageStoreConfig(FULL_FIREBASE_ENV);
    expect(config.kind).toBe('firebase');
    if (config.kind !== 'firebase') throw new Error('expected a firebase config');

    expect(createImageStore(config).kind).toBe('firebase');
  });

  it('accepts a stub signer and transport, so a caller can exercise it offline', () => {
    const config = resolveImageStoreConfig(FULL_FIREBASE_ENV);
    const store = createImageStore(config, {
      firebaseSigner: async () => ({ token: 'stub', expiresAt: Date.now() + 60_000 }),
      firebaseFetch: () => Promise.reject(new Error('should not be called here')),
    });

    expect(store.kind).toBe('firebase');
  });

  it('re-checks the bucket name at construction, for a hand-built config', () => {
    // `createImageStore` is exported and callable with a config that did not
    // come from `resolveImageStoreConfig`, so the URL-safety check has to be at
    // the point of construction too.
    const config = {
      kind: 'firebase',
      bucket: 'bucket@evil.example.com',
      endpoint: DEFAULT_FIREBASE_ENDPOINT,
      prefix: 'images',
      serviceAccount: { clientEmail: CLIENT_EMAIL, privateKey: PRIVATE_KEY_PEM },
      requestTimeoutMs: 1000,
    } satisfies ImageStoreConfig;

    expect(() => createImageStore(config)).toThrow(ImageStoreError);
  });

  it('re-checks the private key at construction, for a hand-built config', () => {
    const config = {
      kind: 'firebase',
      bucket: 'dripl-images.appspot.com',
      endpoint: DEFAULT_FIREBASE_ENDPOINT,
      prefix: 'images',
      serviceAccount: { clientEmail: CLIENT_EMAIL, privateKey: 'not a pem' },
      requestTimeoutMs: 1000,
    } satisfies ImageStoreConfig;

    expect(() => createImageStore(config)).toThrow(ImageStoreError);
  });
});
