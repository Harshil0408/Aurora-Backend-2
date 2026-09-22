import { logger } from '../../config/logger.js';

export interface SecurityMail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: SecurityMail): Promise<void>;
}

/**
 * Dev/test mailer: logs instead of sending. Swap with an SMTP/API
 * implementation (Resend, SES…) via getMailer() — no code changes
 * elsewhere, no credentials in the repo.
 */
class LogMailer implements Mailer {
  async send(mail: SecurityMail): Promise<void> {
    logger.info('Outgoing security mail (logged, not sent)', {
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  }
}

let instance: Mailer | undefined;

export function getMailer(): Mailer {
  if (!instance) instance = new LogMailer();
  return instance;
}

/** Test seam: replace the mailer and inspect sent mail. */
export function setMailer(mailer: Mailer | undefined): void {
  instance = mailer;
}
