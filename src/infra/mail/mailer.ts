import nodemailer, { type Transporter } from 'nodemailer';
import { getEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export interface SecurityMail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: SecurityMail): Promise<void>;
}

/** Dev/test fallback: logs instead of sending. */
class LogMailer implements Mailer {
  async send(mail: SecurityMail): Promise<void> {
    logger.info('Outgoing security mail (logged, not sent)', {
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  }
}

/**
 * Real SMTP mailer (Gmail: smtp.gmail.com:587 + STARTTLS, or any provider).
 * Sends security mail; throws on delivery failure so callers can react.
 */
class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    const env = getEnv();
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      // Gmail displays App Passwords with spaces; SMTP wants them joined.
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS?.replace(/\s+/g, '') },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    this.from = env.MAIL_FROM || (env.SMTP_USER as string);
  }

  async send(mail: SecurityMail): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
    logger.info('Security mail sent via SMTP', { to: mail.to, subject: mail.subject });
  }
}

let instance: Mailer | undefined;

/**
 * SMTP mailer when SMTP_HOST/USER/PASS are configured, LogMailer otherwise.
 * Never throws at boot for missing mail config — auth flows must not depend
 * on the mail provider being up (forgot-password stays generic either way).
 */
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

/** Reset the cached mailer (tests + config reload). */
export function resetMailer(): void {
  instance = undefined;
}

/** Test seam: replace the mailer and inspect sent mail. */
export function setMailer(mailer: Mailer | undefined): void {
  instance = mailer ?? new LogMailer();
}
