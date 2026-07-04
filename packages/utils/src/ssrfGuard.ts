import { lookup } from 'dns';
import { URL } from 'url';

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/i,
  /^f[cd]/i,
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(ip));
}

function resolvePromise(hostname: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true }, (err, addresses) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(addresses.map(a => a.address));
    });
  });
}

export async function isSafeUrl(
  urlStr: string
): Promise<{ safe: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Unsupported protocol: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname;

  if (isPrivateIp(hostname)) {
    return { safe: false, reason: `Hostname resolves to private IP: ${hostname}` };
  }

  try {
    const addresses = await resolvePromise(hostname);
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        return {
          safe: false,
          reason: `Hostname ${hostname} resolves to private IP: ${addr}`,
        };
      }
    }
  } catch {
    return { safe: false, reason: `Failed to resolve hostname: ${hostname}` };
  }

  return { safe: true };
}
