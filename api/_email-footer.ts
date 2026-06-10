// Shared CAN-SPAM / bulk-sender compliance footer for ALL outbound email.
//
// Every marketing/notification email must carry: (1) a working unsubscribe
// mechanism, (2) a physical postal address, and (3) a link to the privacy
// policy. tsa.astro promises "No spam. Unsubscribe anytime." — this footer is
// what makes that promise true.
//
// Two unsubscribe mechanisms, chosen by send path:
//   'broadcast'     — Resend Audience broadcasts (resend.broadcasts.create).
//                     Resend substitutes {{{RESEND_UNSUBSCRIBE_URL}}} with a
//                     per-recipient one-click unsubscribe link, and manages the
//                     List-Unsubscribe headers itself. The placeholder ONLY
//                     substitutes on broadcasts — never use this mode for
//                     transactional sends or recipients see the literal text.
//   'transactional' — per-recipient resend.emails.send. No placeholder support,
//                     so use an honest mailto line, and pair the send with
//                     listUnsubscribeHeaders() (emails.send accepts `headers`;
//                     broadcasts.create does not).

import { escapeHtml } from '../src/lib/escape.js';

/** Sender / reply-to / unsubscribe contact for all outbound email. */
export const EMAIL_CONTACT = 'hello@theblueboard.co';

export const PRIVACY_URL = 'https://theblueboard.co/privacy';

export type EmailFooterMode = 'broadcast' | 'transactional';

/**
 * Compliance footer HTML. Append inside the email's content wrapper.
 * The postal address line renders only when EMAIL_POSTAL_ADDRESS is set
 * (CAN-SPAM requires a real postal address — see .env.example).
 */
export function buildEmailFooterHtml(mode: EmailFooterMode): string {
  const line = 'font-size:11px;color:#6b7280;margin:6px 0 0;text-align:center;line-height:1.6;';
  const link = 'color:#4a90d9;text-decoration:underline;';

  const unsubscribe =
    mode === 'broadcast'
      ? `<a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="${link}">Unsubscribe</a> anytime — one click, no questions asked.`
      : `Unsubscribe anytime: reply &quot;unsubscribe&quot; or email <a href="mailto:${EMAIL_CONTACT}?subject=unsubscribe" style="${link}">${EMAIL_CONTACT}</a>.`;

  const postalAddress = process.env.EMAIL_POSTAL_ADDRESS;
  const postal = postalAddress
    ? `\n    <p style="${line}">${escapeHtml(postalAddress)}</p>`
    : '';

  return `
  <div style="margin-top:28px;padding-top:16px;border-top:1px solid #1a2035;">
    <p style="${line}">${unsubscribe}</p>
    <p style="${line}"><a href="${PRIVACY_URL}" style="${link}">Privacy Policy</a></p>${postal}
  </div>`;
}

/**
 * List-Unsubscribe headers for TRANSACTIONAL sends (resend.emails.send accepts
 * `headers`). Gmail/Yahoo bulk-sender rules check for these. Broadcasts don't
 * need them — Resend adds its own for Audience broadcasts.
 */
export function listUnsubscribeHeaders(): Record<string, string> {
  // mailto-only on purpose: RFC 8058 forbids List-Unsubscribe-Post unless List-Unsubscribe
  // carries an HTTPS URI (one-click POST cannot target a mailto). Transactional welcome mail
  // is exempt from the bulk-sender one-click mandate, so mailto alone is compliant; add the
  // -Post header only if a real HTTPS unsubscribe endpoint ships.
  return {
    'List-Unsubscribe': `<mailto:${EMAIL_CONTACT}?subject=unsubscribe>`,
  };
}
