import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export interface MailConfig {
  SMTP_URL?: string;
  MAIL_FROM: string;
  AGENTMAIL_API_KEY?: string;
  AGENTMAIL_INBOX_ID?: string;
  AGENTMAIL_USERNAME: string;
}

const AGENTMAIL_API = 'https://api.agentmail.to/v0';

/**
 * AgentMail (HTTP API, Vercel Marketplace) when its key is present, otherwise SMTP,
 * otherwise the message is only logged (development / tests).
 */
export function createMailer(config: MailConfig, log: FastifyBaseLogger): Mailer {
  if (config.AGENTMAIL_API_KEY) return agentMailMailer(config.AGENTMAIL_API_KEY, config, log);
  if (config.SMTP_URL) {
    const transport = nodemailer.createTransport(config.SMTP_URL);
    return {
      async send(mail) {
        await transport.sendMail({ from: config.MAIL_FROM, ...mail });
      },
    };
  }
  return {
    async send(mail) {
      log.warn({ to: mail.to, subject: mail.subject }, 'email non configurata: messaggio non inviato');
    },
  };
}

function agentMailMailer(apiKey: string, config: MailConfig, log: FastifyBaseLogger): Mailer {
  const call = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${AGENTMAIL_API}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`AgentMail ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  };

  // The app's own inbox. client_id makes creation idempotent: every instance gets the same one.
  let inbox: Promise<string> | null = config.AGENTMAIL_INBOX_ID ? Promise.resolve(config.AGENTMAIL_INBOX_ID) : null;
  const inboxId = () => {
    inbox ??= (async () => {
      const create = (username?: string) =>
        call<{ inbox_id: string; email: string }>('/inboxes', {
          ...(username ? { username } : {}),
          display_name: 'CardVault',
          client_id: 'cardvault-notifiche',
        });
      let created: { inbox_id: string; email: string };
      try {
        created = await create(config.AGENTMAIL_USERNAME);
      } catch (err) {
        // username taken on the shared domain: let AgentMail pick one
        log.warn({ err: (err as Error).message }, 'AgentMail: nome casella non disponibile, ne uso uno casuale');
        created = await create();
      }
      log.info({ email: created.email }, 'AgentMail: casella mittente pronta');
      return created.inbox_id;
    })().catch((err) => {
      inbox = null;
      throw err;
    });
    return inbox;
  };

  return {
    async send(mail) {
      const id = await inboxId();
      await call(`/inboxes/${encodeURIComponent(id)}/messages/send`, {
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        ...(mail.html ? { html: mail.html } : {}),
      });
    },
  };
}
