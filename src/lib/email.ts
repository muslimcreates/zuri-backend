import { Resend } from "resend";

// Transactional email (currently just "verify your email"). Uses Resend
// because it's free for this volume and doesn't require a registered
// company, only a domain you control — see README "Setting up email
// verification" for how to get an API key and verify a sending domain.
//
// If RESEND_API_KEY isn't set, we don't fail the request that triggered
// the email (e.g. signup should still work) — we just log the link to the
// server console instead. That makes local development work with zero
// setup, and makes it obvious in the logs that email isn't really being
// sent yet.

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function brandedEmailHtml(opts: { title: string; bodyHtml: string; buttonText: string; buttonUrl: string }) {
  return `
  <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
    <p style="letter-spacing: 0.08em; text-transform: uppercase; font-size: 12px; color: #b45309; font-weight: 600; margin: 0 0 24px;">Zuri Express &mdash; For Kenyans, By Kenyans</p>
    <h1 style="font-size: 20px; margin: 0 0 16px;">${opts.title}</h1>
    <div style="font-size: 15px; line-height: 1.6; color: #3a3a3a;">${opts.bodyHtml}</div>
    <a href="${opts.buttonUrl}" style="display: inline-block; margin-top: 24px; background: #b45309; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 6px; font-size: 14px; font-weight: 600;">${opts.buttonText}</a>
    <p style="margin-top: 24px; font-size: 12px; color: #8a8a8a;">If the button doesn't work, copy and paste this link:<br />${opts.buttonUrl}</p>
  </div>`;
}

export async function sendVerificationEmail(opts: { to: string; name: string; verifyUrl: string }) {
  const html = brandedEmailHtml({
    title: `Hi ${opts.name}, please confirm your email`,
    bodyHtml: `<p>Thanks for signing up at Zuri Express. Click below to confirm this is really your email address. This link expires in 24 hours.</p>`,
    buttonText: "Confirm my email",
    buttonUrl: opts.verifyUrl,
  });

  if (!resend) {
    console.log(
      `\n[email] RESEND_API_KEY not set — not actually sending an email.\n` +
        `[email] Verification link for ${opts.to}:\n[email]   ${opts.verifyUrl}\n`
    );
    return;
  }

  const from = process.env.EMAIL_FROM;
  if (!from) {
    console.warn(
      "[email] RESEND_API_KEY is set but EMAIL_FROM is not — skipping send. Add EMAIL_FROM to .env."
    );
    return;
  }

  try {
    await resend.emails.send({
      from,
      to: opts.to,
      subject: "Confirm your email — Zuri Express",
      html,
    });
  } catch (err) {
    // Never let a broken email provider break signup — log and move on.
    console.error("[email] Failed to send verification email:", err);
  }
}
