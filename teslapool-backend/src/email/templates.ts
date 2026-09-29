import type { OutgoingEmail } from './mailer';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Brand-styled, table-based layout (renders in Gmail, Outlook and Apple Mail). Inline styles only. */
function layout(opts: { preheader: string; heading: string; intro: string; code: string; minutes: number; actionUrl: string; actionLabel: string; footnote: string }): string {
  const digits = opts.code
    .split('')
    .map((d) => `<td style="padding:0 4px"><div style="width:44px;height:56px;line-height:56px;border-radius:12px;background:#FFFEE9;border:2px solid #151515;font:900 28px/56px Roboto,Arial,sans-serif;color:#151515;text-align:center">${d}</div></td>`)
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:#FFFEE9">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFEE9;padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:28px;border:1px solid rgba(21,21,21,.08);overflow:hidden">
    <tr><td style="background:#C1F11D;padding:22px 28px;font:900 24px Roboto,Arial,sans-serif;color:#151515">Tesla<span style="color:#151515">Pool</span></td></tr>
    <tr><td style="padding:32px 28px 8px;font:900 26px/1.2 Roboto,Arial,sans-serif;color:#151515">${esc(opts.heading)}</td></tr>
    <tr><td style="padding:0 28px 24px;font:400 15px/1.6 Roboto,Arial,sans-serif;color:#3a3a3a">${opts.intro}</td></tr>
    <tr><td align="center" style="padding:0 28px 12px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${digits}</tr></table></td></tr>
    <tr><td align="center" style="padding:0 28px 28px;font:500 13px Roboto,Arial,sans-serif;color:#797979">This code expires in ${opts.minutes} minutes.</td></tr>
    <tr><td align="center" style="padding:0 28px 32px"><a href="${esc(opts.actionUrl)}" style="display:inline-block;background:#151515;color:#C1F11D;text-decoration:none;font:700 14px Roboto,Arial,sans-serif;padding:14px 26px;border-radius:12px">${esc(opts.actionLabel)}</a></td></tr>
    <tr><td style="padding:20px 28px;background:#f7f7f2;font:400 12px/1.6 Roboto,Arial,sans-serif;color:#797979">${esc(opts.footnote)}<br>TeslaPool · Shared auto-rickshaw rides for Dhaka</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

export function verificationEmail(to: { email: string; name: string }, code: string, minutes: number, appUrl: string): OutgoingEmail {
  const first = to.name.trim().split(/\s+/)[0] || 'there';
  const url = `${appUrl}/verify-email`;
  return {
    to,
    tag: 'verify-email',
    subject: `${code} is your TeslaPool verification code`,
    html: layout({
      preheader: `Your TeslaPool code is ${code}`,
      heading: 'Confirm your email',
      intro: `Hi ${esc(first)}, welcome to TeslaPool. Enter this code to confirm your email and start sharing rides.`,
      code,
      minutes,
      actionUrl: url,
      actionLabel: 'Open verification page',
      footnote: "Didn't create a TeslaPool account? You can ignore this email; nothing will happen.",
    }),
    text: `Hi ${first},\n\nYour TeslaPool verification code is ${code}. It expires in ${minutes} minutes.\nEnter it at ${url}\n\nDidn't create an account? Ignore this email.`,
  };
}

export function passwordResetEmail(to: { email: string; name: string }, code: string, minutes: number, appUrl: string): OutgoingEmail {
  const first = to.name.trim().split(/\s+/)[0] || 'there';
  const url = `${appUrl}/reset-password?email=${encodeURIComponent(to.email)}`;
  return {
    to,
    tag: 'reset-password',
    subject: `${code} is your TeslaPool password reset code`,
    html: layout({
      preheader: `Reset your TeslaPool password with code ${code}`,
      heading: 'Reset your password',
      intro: `Hi ${esc(first)}, someone (hopefully you) asked to reset your TeslaPool password. Use this code to choose a new one.`,
      code,
      minutes,
      actionUrl: url,
      actionLabel: 'Choose a new password',
      footnote: "Didn't ask for this? Your password has not changed; you can ignore this email.",
    }),
    text: `Hi ${first},\n\nYour TeslaPool password reset code is ${code}. It expires in ${minutes} minutes.\nReset at ${url}\n\nDidn't ask for this? Ignore this email; your password is unchanged.`,
  };
}
