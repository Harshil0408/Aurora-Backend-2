import { beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '../src/config/env.js';
import { getMailer, resetMailer, setMailer } from '../src/infra/mail/mailer.js';

beforeEach(() => {
  resetMailer();
  resetEnvCache();
  delete process.env['SMTP_HOST'];
  delete process.env['SMTP_USER'];
  delete process.env['SMTP_PASS'];
});

describe('mailer selection', () => {
  it('falls back to LogMailer without SMTP config (no network)', async () => {
    const mailer = getMailer();
    await expect(mailer.send({ to: 'a@x.com', subject: 't', text: 'hi' })).resolves.toBeUndefined();
  });

  it('setMailer(undefined) restores the default without throwing', async () => {
    setMailer(undefined);
    await expect(
      getMailer().send({ to: 'a@x.com', subject: 't', text: 'hi' }),
    ).resolves.toBeUndefined();
  });

  it('uses SMTP mailer when fully configured (no send attempted)', () => {
    process.env['SMTP_HOST'] = 'smtp.gmail.com';
    process.env['SMTP_USER'] = 'user@gmail.com';
    process.env['SMTP_PASS'] = 'app-password';
    expect(getMailer().constructor.name).toBe('SmtpMailer');
  });
});
