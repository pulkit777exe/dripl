import { createLogger } from '@dripl/utils/logger';

const log = createLogger('ws-server:auth');

export function resolveTicketFromUrl(reqUrl: string | undefined, host: string | undefined): string | null {
  if (!reqUrl || !host) return null;
  try {
    const url = new URL(reqUrl, `http://${host}`);
    return url.searchParams.get('ticket');
  } catch {
    log.warn({ event: 'ticket_parse_failed' });
    return null;
  }
}

export async function validateTicket(ticket: string): Promise<string | null> {
  const httpServerUrl = process.env.HTTP_SERVER_URL;
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!httpServerUrl || !internalSecret) {
    log.error({ event: 'ticket_validation_config_missing', httpServerUrl: !!httpServerUrl, internalSecret: !!internalSecret });
    return null;
  }

  try {
    const resp = await fetch(`${httpServerUrl}/internal/validate-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': internalSecret,
      },
      body: JSON.stringify({ ticket }),
    });

    if (!resp.ok) {
      log.warn({ event: 'ticket_validation_rejected', status: resp.status });
      return null;
    }

    const data = (await resp.json()) as { userId: string };
    return data.userId ?? null;
  } catch (err) {
    log.error({ event: 'ticket_validation_error', error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
