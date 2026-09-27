/**
 * Emailed 2FA code content (Aurora Admin theme).
 *
 * Pure functions — no env/DB access — so they are unit-testable.
 */

export interface EmailOtpMail {
  subject: string;
  text: string;
  html: string;
}

export function buildEmailOtpMail(code: string, purpose: 'enable' | 'login'): EmailOtpMail {
  const title = purpose === 'enable' ? 'Verify your email for 2FA' : 'Your admin login code';
  const intro =
    purpose === 'enable'
      ? 'Enter this code to finish enabling email 2FA on your Aurora Admin account.'
      : 'Enter this code to finish logging in to Aurora Admin.';
  return {
    subject: `Aurora Admin: your verification code is ${code}`,
    text: [
      `${title}.`,
      '',
      intro,
      '',
      `Your verification code: ${code}`,
      '',
      'This code expires in 10 minutes and can be used once.',
      "Didn't request this? Ignore this email — your account stays unchanged.",
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
<tr><td style="padding:16px 32px 0 32px;font-family:'Manrope','Segoe UI',system-ui,sans-serif;font-size:24px;font-weight:700;color:#1d1a3b;">${title}</td></tr>
<tr><td style="padding:8px 32px 0 32px;font-family:'Manrope','Segoe UI',system-ui,sans-serif;font-size:15px;line-height:1.5;color:#68648a;">${intro}</td></tr>
<tr><td align="center" style="padding:24px 32px 8px 32px;font-family:monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#1d1a3b;">${code}</td></tr>
<tr><td style="padding:8px 32px 0 32px;font-family:'Manrope','Segoe UI',system-ui,sans-serif;font-size:13px;line-height:1.5;color:#9a96b8;">This code expires in <strong style="color:#68648a;">10 minutes</strong> and can be used once.</td></tr>
<tr><td style="padding:24px 32px 32px 32px;font-family:'Manrope','Segoe UI',system-ui,sans-serif;font-size:12px;color:#9a96b8;border-top:1px solid #e6e3f3;">Aurora Admin &middot; automated security mail, please do not reply.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  };
}
