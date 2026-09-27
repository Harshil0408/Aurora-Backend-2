import { describe, expect, it } from 'vitest';
import {
  buildPasswordResetMail,
  buildPasswordResetUrl,
} from '../src/modules/admin-panel/auth/utils/resetMail.js';

describe('password reset mail', () => {
  it('builds the reset URL from origin + token', () => {
    expect(buildPasswordResetUrl('http://localhost:3000', 'abc123')).toBe(
      'http://localhost:3000/admin/reset-password?token=abc123',
    );
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(buildPasswordResetUrl('http://localhost:3000/', 'abc123')).toBe(
      'http://localhost:3000/admin/reset-password?token=abc123',
    );
  });

  it('mail carries the link, token, and brand styling in both bodies', () => {
    const url = 'http://localhost:3000/admin/reset-password?token=abc123';
    const mail = buildPasswordResetMail(url, 'abc123');
    expect(mail.subject).toContain('Aurora Admin');
    expect(mail.text).toContain(url);
    expect(mail.text).toContain('abc123');
    expect(mail.html).toContain(url);
    expect(mail.html).toContain('abc123');
    expect(mail.html).toContain('#5b3df5');
    expect(mail.html).toContain('#f2f0fb');
  });
});
