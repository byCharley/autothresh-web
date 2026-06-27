import { Resend } from 'resend';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const resend    = new Resend(process.env.RESEND_API_KEY);
const FROM      = process.env.RESEND_FROM_EMAIL ?? 'AutoThresh <noreply@charleypangus.com>';
const TO        = 'info@charleypangus.com';

const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, type, message } = req.body as {
    name?: string; email?: string; type?: string; message?: string;
  };

  if (!name?.trim() || !email?.trim() || !message?.trim())
    return res.status(400).json({ error: 'Name, email, and message are required.' });

  if (!EMAIL_RE.test(email))
    return res.status(400).json({ error: 'Invalid email address.' });

  const safeName    = esc(name.trim());
  const safeEmail   = esc(email.trim());
  const safeType    = esc(type?.trim() ?? 'General');
  const safeMessage = esc(message.trim());

  try {
    // Notify Charley
    await resend.emails.send({
      from:    FROM,
      to:      TO,
      replyTo: email.trim(),
      subject: `[AutoThresh] ${safeType} — ${safeName}`,
      html: `
        <div style="font-family:monospace;font-size:13px;color:#1a1a1a;max-width:520px">
          <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
            <tr><td style="padding:4px 0;color:#888;width:80px">From</td><td>${safeName} &lt;${safeEmail}&gt;</td></tr>
            <tr><td style="padding:4px 0;color:#888">Type</td><td>${safeType}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #e0e0e0;margin:0 0 16px"/>
          <p style="white-space:pre-wrap;line-height:1.6;margin:0">${safeMessage}</p>
        </div>
      `,
    });

    // Confirmation to user
    await resend.emails.send({
      from:    FROM,
      to:      email.trim(),
      subject: 'Message received — AutoThresh™',
      html: `
        <div style="font-family:monospace;font-size:13px;color:#1a1a1a;max-width:480px">
          <p style="margin:0 0 12px">Hi ${safeName},</p>
          <p style="margin:0 0 12px">Your message has been received. I'll get back to you as soon as possible.</p>
          <hr style="border:none;border-top:1px solid #e0e0e0;margin:16px 0"/>
          <p style="margin:0;color:#888;font-size:11px">AutoThresh™ Web — Charley Pangus</p>
        </div>
      `,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Resend contact error:', err);
    return res.status(500).json({ error: 'Failed to send message. Please try again.' });
  }
}
