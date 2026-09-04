import { Resend } from "resend";

// Promotional emails ("new arrivals", sales, seasonal offers) are handled
// almost entirely outside this codebase: this file's only job is to keep a
// Resend Audience in sync with who has opted in. Actually *composing and
// sending* a promotional email is done from Resend's own dashboard
// (Audiences -> your audience -> Broadcasts -> New broadcast) whenever you
// have something to announce — Resend handles the unsubscribe link and
// unsubscribe bookkeeping automatically for you there, so there's no
// "send announcement" admin feature to build or maintain here.
//
// Same fire-and-forget pattern as src/lib/email.ts: never let a missing key
// or a failed request break signup.

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function addToMarketingAudience(opts: { email: string; name: string }) {
  const audienceId = process.env.RESEND_AUDIENCE_ID;

  if (!resend || !audienceId) {
    console.log(
      `[marketing] RESEND_API_KEY/RESEND_AUDIENCE_ID not set — not adding ${opts.email} to the marketing audience.`
    );
    return;
  }

  try {
    await resend.contacts.create({
      audienceId,
      email: opts.email,
      firstName: opts.name,
      unsubscribed: false,
    });
  } catch (err) {
    console.error("[marketing] Failed to add contact to Resend audience:", err);
  }
}
