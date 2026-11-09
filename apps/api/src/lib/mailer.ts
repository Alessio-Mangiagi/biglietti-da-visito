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

/** SMTP when configured; otherwise the message is logged (development / tests). */
export function createMailer(smtpUrl: string | undefined, from: string, log: FastifyBaseLogger): Mailer {
  if (!smtpUrl) {
    return {
      async send(mail) {
        log.warn({ to: mail.to, subject: mail.subject, text: mail.text }, 'SMTP non configurato: email non inviata');
      },
    };
  }
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(mail) {
      await transport.sendMail({ from, ...mail });
    },
  };
}
