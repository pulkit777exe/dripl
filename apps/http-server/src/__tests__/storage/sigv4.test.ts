import { describe, expect, it } from 'vitest';
import {
  SHA256_OF_EMPTY_PAYLOAD,
  formatAmzDate,
  sha256Hex,
  signRequest,
  uriEncode,
} from '../../storage/sigv4';

/**
 * Vectors from AWS's published `aws-sig-v4-test-suite`
 * (github.com/saibotsivad/aws-sig-v4-test-suite, a verbatim copy of the
 * awslabs suite), plus one canonical-request assertion from the S3 API
 * reference's SigV4 page. These are the same vectors every other SigV4
 * implementation is checked against, so a divergence here is a known failure
 * rather than a hunch.
 *
 * The suite's fixed configuration:
 *   access key `AKIDEXAMPLE`
 *   secret key `wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY`
 *   region `us-east-1`, service `service`, date `2015-08-30T12:36:00Z`
 *
 * The service is `service` rather than `s3` on purpose: these vectors exercise
 * the signer, and the service name is one already-asserted field of the
 * credential scope, not a thing the signer interprets.
 */
const CREDENTIALS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};
const HOST = 'example.amazonaws.com';
const DATE = new Date('2015-08-30T12:36:00Z');

type SigV4Input = Parameters<typeof signRequest>[0];

/** `method` is required at every call site; everything else has a default. */
function baseInput(overrides: Partial<SigV4Input> & Pick<SigV4Input, 'method'>): SigV4Input {
  return {
    credentials: CREDENTIALS,
    region: 'us-east-1',
    service: 'service',
    host: HOST,
    path: '/',
    payloadHash: SHA256_OF_EMPTY_PAYLOAD,
    date: DATE,
    ...overrides,
  };
}

describe('sigv4 against the AWS test suite', () => {
  it('reproduces get-vanilla byte for byte', () => {
    const result = signRequest(baseInput({ method: 'GET' }));

    expect(result.amzDate).toBe('20150830T123600Z');
    expect(result.canonicalRequest).toBe(
      [
        'GET',
        '/',
        '',
        'host:example.amazonaws.com',
        'x-amz-date:20150830T123600Z',
        '',
        'host;x-amz-date',
        SHA256_OF_EMPTY_PAYLOAD,
      ].join('\n')
    );
    // The suite's `.sts` file ends with the SHA-256 of the canonical request;
    // asserting on it proves the canonical request is byte-identical to the
    // one AWS canonicalized, not merely equivalent.
    expect(sha256Hex(Buffer.from(result.canonicalRequest, 'utf8'))).toBe(
      'bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63'
    );
    expect(result.stringToSign).toBe(
      [
        'AWS4-HMAC-SHA256',
        '20150830T123600Z',
        '20150830/us-east-1/service/aws4_request',
        'bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63',
      ].join('\n')
    );
    expect(result.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'
    );
  });

  it('reproduces post-vanilla', () => {
    const result = signRequest(baseInput({ method: 'POST' }));

    expect(result.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b'
    );
  });

  it('sorts query parameters by name regardless of the order given', () => {
    const result = signRequest(
      baseInput({ method: 'GET', query: { Param2: 'value2', Param1: 'value1' } })
    );

    // get-vanilla-query-order-key-case: the request carries
    // `?Param2=value2&Param1=value1` and the canonical query is sorted.
    expect(result.canonicalRequest.split('\n')[2]).toBe('Param1=value1&Param2=value2');
    expect(result.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500'
    );
  });

  it('leaves every unreserved character in the path unencoded', () => {
    const unreserved = '/-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const result = signRequest(baseInput({ method: 'GET', path: unreserved }));

    expect(result.canonicalRequest.split('\n')[1]).toBe(unreserved);
    expect(result.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=07ef7494c76fa4850883e2b006601f940f8a34d404d0cfa977f52a65bbf5f24f'
    );
  });

  it('hashes a request body to the value AWS publishes for it', () => {
    // post-x-www-form-urlencoded: payload `Param1=value1`.
    expect(sha256Hex(Buffer.from('Param1=value1', 'utf8'))).toBe(
      '9095672bbd1f56dfc5b65f3e153adc8731a4a654192329106275f4c7b24d0b6e'
    );
  });
});

describe('sigv4 canonicalization', () => {
  it('lowercases header names, trims values, and sorts them by name', () => {
    const result = signRequest(
      baseInput({
        method: 'PUT',
        headers: {
          'Content-Type': '  image/png  ',
          'X-Amz-Meta-Zed': 'z',
          'x-amz-meta-alpha': 'a',
        },
        payloadHash: sha256Hex(Buffer.from('body', 'utf8')),
      })
    );

    expect(result.canonicalRequest).toContain(
      'content-type:image/png\nhost:example.amazonaws.com\n' +
        'x-amz-date:20150830T123600Z\nx-amz-meta-alpha:a\nx-amz-meta-zed:z\n'
    );
    expect(result.signedHeaders).toBe(
      'content-type;host;x-amz-date;x-amz-meta-alpha;x-amz-meta-zed'
    );
  });

  it('never signs a host header it did not derive from the request target', () => {
    // A caller-supplied `host` header would be a signature over a value the
    // HTTP client is not going to send, so the explicit host always wins.
    const result = signRequest(baseInput({ method: 'GET', headers: { Host: 'evil.example.com' } }));

    expect(result.canonicalRequest).toContain(`host:${HOST}\n`);
    expect(result.canonicalRequest).not.toContain('evil.example.com');
    expect(result.headers).not.toHaveProperty('host');
  });

  it('signs each `/` segment of a key separately and keeps the separators', () => {
    const result = signRequest(baseInput({ method: 'GET', path: '/nested/a b/c.png' }));

    expect(result.canonicalRequest.split('\n')[1]).toBe('/nested/a%20b/c.png');
  });

  it('produces no header set containing the secret access key', () => {
    const result = signRequest(baseInput({ method: 'PUT' }));

    expect(Object.values(result.headers).join('\n')).not.toContain(CREDENTIALS.secretAccessKey);
    // The access key id is part of the Credential= field by protocol design.
    expect(result.headers.authorization).toContain(CREDENTIALS.accessKeyId);
  });
});

describe('sigv4 primitives', () => {
  it('encodes the five characters encodeURIComponent leaves behind', () => {
    expect(uriEncode("!'()*")).toBe('%21%27%28%29%2A');
    expect(uriEncode('a b/c')).toBe('a%20b%2Fc');
    expect(uriEncode('-._~')).toBe('-._~');
  });

  it('percent-encodes multibyte characters as UTF-8', () => {
    expect(uriEncode('é')).toBe('%C3%A9');
    expect(uriEncode('🔑')).toBe('%F0%9F%94%91');
  });

  it('formats an instant as the compact basic format', () => {
    expect(formatAmzDate(new Date('2013-05-24T00:00:00Z'))).toBe('20130524T000000Z');
    expect(formatAmzDate(new Date('2026-01-02T03:04:05.678Z'))).toBe('20260102T030405Z');
  });

  it('uppercases the method', () => {
    expect(signRequest(baseInput({ method: 'put' })).canonicalRequest.startsWith('PUT\n')).toBe(
      true
    );
  });
});
