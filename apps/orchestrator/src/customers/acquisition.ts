import type { AcquisitionChannel, CustomerChannel } from "@jarvis/shared";

/**
 * Where a customer entered the funnel, inferred from what arrived with their
 * first message. Explicit UTM tags win over the referrer because they are a
 * deliberate statement by whoever built the link; the referrer is the browser's
 * best guess and is often stripped (HTTPS to HTTP, app webviews, privacy modes).
 *
 * A message that arrives *on* a platform (an X DM, an Instagram message, an
 * inbound email) is attributed to that platform, since the customer reached
 * out there. A website visitor with no evidence at all is "direct", which is
 * also what typed URLs, bookmarks, and stripped referrers look like, so read
 * "direct" as "unknown, probably not a campaign" rather than proof of anything.
 */
export function inferAcquisitionChannel(input: {
  conversationChannel: CustomerChannel;
  utmSource?: string | null;
  utmMedium?: string | null;
  referrer?: string | null;
}): Exclude<AcquisitionChannel, null> {
  const fromUtm = channelFromUtm(input.utmSource, input.utmMedium);
  if (fromUtm) return fromUtm;
  if (input.conversationChannel !== "website") return input.conversationChannel;
  return channelFromReferrer(input.referrer) ?? "direct";
}

const SOURCE_ALIASES: Array<[RegExp, Exclude<AcquisitionChannel, null>]> = [
  [/^(x|twitter|x\.com|twitter\.com|t\.co)$/, "x"],
  [/^(instagram|ig|instagram\.com)$/, "instagram"],
  [/^(facebook|fb|meta|facebook\.com)$/, "facebook"],
  [/^(email|e-mail|newsletter|mailchimp|resend|klaviyo|convertkit|substack)$/, "email"],
  [/^(google|bing|duckduckgo|yahoo|ecosia|brave|kagi)$/, "search"],
];

function channelFromUtm(source?: string | null, medium?: string | null): Exclude<AcquisitionChannel, null> | null {
  const s = source?.trim().toLowerCase() ?? "";
  const m = medium?.trim().toLowerCase() ?? "";
  for (const [pattern, channel] of SOURCE_ALIASES) if (pattern.test(s)) return channel;
  if (m === "email") return "email";
  // Tagged, but by a source we don't have a bucket for (a partner, a podcast):
  // still a deliberate external link, which is what "referral" means here.
  return s || m ? "referral" : null;
}

const REFERRER_HOSTS: Array<[RegExp, Exclude<AcquisitionChannel, null>]> = [
  [/(^|\.)(t\.co|x\.com|twitter\.com)$/, "x"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, "facebook"],
  [/^(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|mail\.yahoo\.com|mail\.proton\.me)$/, "email"],
  [/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|ecosia\.org|search\.brave\.com|kagi\.com)$/, "search"],
];

function channelFromReferrer(referrer?: string | null): Exclude<AcquisitionChannel, null> | null {
  if (!referrer) return null;
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;
  for (const [pattern, channel] of REFERRER_HOSTS) if (pattern.test(host)) return channel;
  return "referral";
}
