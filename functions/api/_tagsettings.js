// Smart QR tag: one place for every switch, cap, and piece of consent wording. Nothing here talks to the network.
import FINISH_FLAGS from '../../site/tag-qr-finishes.json' with { type: 'json' };
import SDTQR from '../../site/tag-qr.js';
import { sha256Hex } from './_tagid.js';

// The only way a handler touches site/tag-qr.js config: finish gates from site/tag-qr-finishes.json, payload base from TAG_BASE_URL.
export function qrConfig(env) {
  SDTQR.configure({ finishes: FINISH_FLAGS.finishes, base: env && typeof env.TAG_BASE_URL === 'string' && env.TAG_BASE_URL.trim() ? env.TAG_BASE_URL.trim().toUpperCase() : null });
  return SDTQR;
}

export const hasDb = (env) => Boolean(env && env.TAGDB && typeof env.TAGDB.prepare === 'function');
// Smart tags exist only when the D1 binding is there AND SMART_ENABLED is not "false". Rolling back = SMART_ENABLED=false:
// the toggle disappears and nothing new is minted; every existing finder page keeps working.
export const smartEnabled = (env) => hasDb(env) && String((env && env.SMART_ENABLED) ?? 'true').trim().toLowerCase() !== 'false';

// SMS alerts: ON by default (Nick, 2026-11-16). SMS_ALERTS_ENABLED=false turns every owner text off; email is unaffected.
export const smsFlag = (env) => String((env && env.SMS_ALERTS_ENABLED) ?? 'true').trim().toLowerCase() !== 'false';
// Sending also needs the Twilio account and the separate Messaging Service for owner alerts (TAG_TWILIO_MSID). It is NOT the number
// relay.js uses for Thirsty Beaches marketing: owner alerts have their own STOP state and A2P campaign.
export const smsReady = (env) => smsFlag(env) && Boolean(env.TWILIO_SID && env.TWILIO_TOKEN && env.TAG_TWILIO_MSID);

export const ALERT_FROM = 'Salty Dog Tags <alerts@saltydogtags.com>';

// Plans. The finder page, the message relay and email alerts are never gated, so a lapsed plan drops to email only.
export const SMART_PLAN = (env) => (String((env && env.SMART_PLAN) || 'free').toLowerCase() === 'annual' ? 'annual' : 'free');
export function planAllows(tag, feature, env, now = Date.now()) {
  if (!['sms', 'history', 'contact2'].includes(feature)) return true;
  if (SMART_PLAN(env) === 'free') return true;
  return Boolean(tag && tag.paid_through && tag.paid_through > now);
}

// Limits (ADR section 4). Every one in one table so Breaker and Tunnel Rat read the same numbers the code uses.
export const LIMITS = {
  burstMs: 10 * 60 * 1000,
  locMoveM: 250, locPerBurst: 3,
  msgPerTagHour: 5,
  smsPerTagDay: 12, smsGlobalDay: 500, emailGlobalDay: 2000,
  retryWindowMs: 2 * 3600 * 1000, retryMaxTries: 3,
  scanKeepMs: 30 * 24 * 3600 * 1000, ipHashKeepMs: 24 * 3600 * 1000, alertKeepMs: 30 * 24 * 3600 * 1000,
  pinsPerTag: 20,
  unclaimedForwardMs: 24 * 3600 * 1000,
  testAlertsPerTagHour: 3,
  messageMax: 300, replyMax: 120, ownerMsgMax: 200, placeMax: 120, smsBodyMsgMax: 120,
  loginTokenMs: 15 * 60 * 1000, sessionMs: 30 * 24 * 3600 * 1000, smsCodeMs: 10 * 60 * 1000, smsCodeTries: 5,
  claimFailLock: 5,
  rl: {
    miss: [30, 3600], scanIp: [20, 3600], scanIpTag: [1, 600], message: [5, 3600], messageTag: [3, 86400],
    location: [6, 3600], claim: [10, 3600], authEmail: [3, 3600], authIp: [10, 3600], smsSend: [5, 3600]
  }
};

// Consent wording is versioned and hashed, like TB's SMS_CONSENT_V1: the version id and the SHA-256 of the exact text are stored
// with every opt-in, so we can show what a person agreed to. Change the text => bump the version.
export const SMS_CONSENT_VERSION = 'sdt-sms-v1-2026-11-16';
export const SMS_CONSENT_TEXT = 'I agree to receive text alerts from Salty Dog Tags about this tag: when it is scanned, a finder shares a location or sends a message, and account notices. About 1 to 12 texts a day at most, only when something happens. Message and data rates may apply. Reply STOP to cancel and HELP for help. Consent is not a condition of buying anything. Terms and privacy: saltydogtags.com/policies and saltydogtags.com/privacy.';
export const LOC_CONSENT_VERSION = 'sdt-loc-v1-2026-11-16';
export const LOC_CONSENT_TEXT = 'Send your current location to this dog\'s family once. It is deleted after 30 days.';
export const consentHash = async (text) => (await sha256Hex(text)).slice(0, 16);
