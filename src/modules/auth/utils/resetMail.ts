/**
 * Password-reset mail content (Aurora Admin theme).
 *
 * Pure functions — no env/DB access — so they are unit-testable.
 * The HTML uses table layout + inline styles only: most email clients
 * strip `<style>` blocks and external CSS.
 */

export function buildPasswordResetUrl(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/admin/reset-password?token=${encodeURIComponent(token)}`;
}

export interface PasswordResetMail {
  subject: string;
  text: string;
  html: string;
}

/** Minimal HTML escaping for interpolated values (URLs/tokens). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildPasswordResetMail(resetUrl: string, token: string): PasswordResetMail {
  const safeUrl = escapeHtml(resetUrl);
  const safeToken = escapeHtml(token);
  return {
    subject: 'Reset your Aurora Admin password',
    text: [
      'You requested a password reset for your Aurora Admin account.',
      '',
      `Reset it within 1 hour using this link: ${resetUrl}`,
      '',
      `If the link doesn't work, open the reset page and paste this token manually: ${token}`,
      '',
      "Didn't request this? Your password stays unchanged — ignore this email.",
    ].join('\n'),
    html: `<!doctype html>
<html>
<body style="margin:0;padding:0;background-color:#f2f0fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f0fb;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#ffffff;border:1px solid #e6e3f3;border-radius:16px;">
<tr><td style="padding:32px 32px 8px 32px;font-family:'Manrope','Segoe UI',system-ui,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:36px;height:36px;background-color:#5b3df5;border-radius:10px;text-align:center;font-family:'Manrope','Segoe UI',system-ui,sans-serif;font-size:18px;font-weight:700;color:#ffffff;">A</td>
<td style="padding-left:12px;font-family:'Manrope','Segoe UI',system-ui,sans-serif;font-size:17px;font-weight:700;color:#1d1a3b;">Aurora Admin</td>
</tr></table>
</td></tr>
<tr><td style="padding:16px 32px 0 32px;font-family:'Manrope','Segoe UI',system-ui,sans-serif;font-size:24px;font-weight:700;color:#1d1a3b;">Reset your password</td></tr>
<tr><td style="padding:8px 32px 0 32px;font-family:'Manrope','Segoe UI',system-ui,sans-serif;font-size:15px;line-height:1.5;color:#68648a;">We received a request to reset your admin password. Click the button below to choose a new one.</td></tr>
<tr><td align="center" style="padding:24px 32px 8px 32px;">
<a href="${safeUrl}" style="display:inline-block;background-color:#5b3df5;color:#ffffff;font-family:'Manrope','Segoe UI',system-ui,sans-serif;font-size:15px;font-weight:700;text-decoration:none;padding:13px 32px;border-radius:12px;">Reset password</a>
</td></tr>
<tr><td style="padding:8px 32px 0 32px;font-family:'Manrope','Segoe UI',system-ui,sans-serif;font-size:13px;line-height:1.5;color:#9a96b8;">This link expires in <strong style="color:#68648a;">1 hour</strong> and can be used once. Button not working? Paste this link into your browser:<br><a href="${safeUrl}" style="color:#5b3df5;word-break:break-all;">${safeUrl}</a></td></tr>
<tr><td style="padding:16px 32px 0 32px;font-family:'Manrope','Segoe UI',system-ui,sans-serif;font-size:13px;line-height:1.5;color:#9a96b8;">Or enter this token manually on the reset page:<br><span style="font-family:monospace;font-size:14px;color:#1d1a3b;word-break:break-all;">${safeToken}</span></td></tr>
<tr><td style="padding:16px 32px 0 32px;font-family:'Manrope','Segoe UI',system-ui,sans-serif;font-size:13px;line-height:1.5;color:#9a96b8;">Didn&apos;t request this? Your password stays unchanged &mdash; you can safely ignore this email.</td></tr>
<tr><td style="padding:24px 32px 32px 32px;font-family:'Manrope','Segoe UI',system-ui,sans-serif;font-size:12px;color:#9a96b8;border-top:1px solid #e6e3f3;">Aurora Admin &middot; automated security mail, please do not reply.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  };
}
