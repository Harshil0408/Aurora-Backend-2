import nodemailer, { type Transporter } from 'nodemailer';
import { getEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export interface SecurityMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(mail: SecurityMail): Promise<void>;
}

class LogMailer implements Mailer {
  async send(mail: SecurityMail): Promise<void> {
    logger.info('Outgoing security mail (logged, not sent)', {
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  }
}

class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    const env = getEnv();
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS?.replace(/\s+/g, '') },
      tls: env.SMTP_TLS_INSECURE ? { rejectUnauthorized: false } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    if (env.SMTP_TLS_INSECURE) {
      logger.warn('SMTP TLS verification disabled (SMTP_TLS_INSECURE=true) — dev networks only');
    }
    this.from = env.MAIL_FROM || (env.SMTP_USER as string);
  }

  async send(mail: SecurityMail): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    logger.info('Security mail sent via SMTP', { to: mail.to, subject: mail.subject });
  }
}

let instance: Mailer | undefined;

export function getMailer(): Mailer {
  if (!instance) {
    const env = getEnv();
    if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
      logger.info('SMTP mailer enabled', { host: env.SMTP_HOST });
      instance = new SmtpMailer();
    } else {
      instance = new LogMailer();
    }
  }
  return instance;
}

export function resetMailer(): void {
  instance = undefined;
}

export function setMailer(mailer: Mailer | undefined): void {
  instance = mailer ?? new LogMailer();
}
