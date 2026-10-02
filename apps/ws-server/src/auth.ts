import { createLogger } from '@dripl/utils/logger';

const log = createLogger('ws-server:auth');

export function resolveTicketFromUrl(
  reqUrl: string | undefined,
  host: string | undefined
): string | null {
  if (!reqUrl || !host) return null;
  try {
    const url = new URL(reqUrl, `http://${host}`);
    const ticket = url.searchParams.get('ticket');
    if (!ticket || ticket.length > 512 || !/^[A-Za-z0-9._~-]+$/.test(ticket)) return null;
    return ticket;
  } catch {
    log.warn({ event: 'ticket_parse_failed' });
    return null;
  }
}

export type WsTicketPrincipal =
  | { kind: 'user'; userId: string }
  | { kind: 'share'; fileId: string; token: string; permission: 'view' | 'edit' };

export async function validateTicket(ticket: string): Promise<WsTicketPrincipal | null> {
  const httpServerUrl = process.env.HTTP_SERVER_URL;
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!httpServerUrl || !internalSecret) {
    log.error({
      event: 'ticket_validation_config_missing',
      httpServerUrl: !!httpServerUrl,
      internalSecret: !!internalSecret,
    });
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const resp = await fetch(`${httpServerUrl}/internal/validate-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': internalSecret,
      },
      body: JSON.stringify({ ticket }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      log.warn({ event: 'ticket_validation_rejected', status: resp.status });
      return null;
    }

    const data = (await resp.json()) as Partial<WsTicketPrincipal>;
    if (
      data.kind === 'user' &&
      typeof data.userId === 'string' &&
      data.userId.length > 0 &&
      data.userId.length <= 100
    ) {
      return { kind: 'user', userId: data.userId };
    }
    if (
      data.kind === 'share' &&
      typeof data.fileId === 'string' &&
      data.fileId.length > 0 &&
      data.fileId.length <= 100 &&
      typeof data.token === 'string' &&
      data.token.length > 0 &&
      data.token.length <= 200 &&
      (data.permission === 'view' || data.permission === 'edit')
    ) {
      return { kind: 'share', fileId: data.fileId, token: data.token, permission: data.permission };
    }
    return null;
  } catch (err) {
    log.error({
      event: 'ticket_validation_error',
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
