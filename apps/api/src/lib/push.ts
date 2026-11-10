import webpush from 'web-push';
import type { Config } from '../config';

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** In-app path opened when the notification is tapped. */
  url: string;
  tag?: string;
}

/** 'gone': the browser dropped the subscription, delete it. */
export type PushResult = 'ok' | 'gone' | 'error';

export interface PushSender {
  enabled: boolean;
  publicKey: string | null;
  send(sub: PushSubscriptionKeys, msg: PushMessage): Promise<PushResult>;
}

/**
 * The API posts to whatever endpoint a browser hands over, so only the real push services
 * are accepted (no requests to internal hosts on a client's behalf).
 */
export function isPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  const h = url.hostname.toLowerCase();
  return (
    h === 'fcm.googleapis.com' ||
    h === 'updates.push.services.mozilla.com' ||
    h.endsWith('.push.apple.com') ||
    h.endsWith('.notify.windows.com')
  );
}

export function createPushSender(config: Config): PushSender {
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv } = config;
  if (!pub || !priv) return { enabled: false, publicKey: null, send: async () => 'error' };
  const subject = config.VAPID_SUBJECT ?? config.APP_URL;
  return {
    enabled: true,
    publicKey: pub,
    async send(sub, msg) {
      if (!isPushEndpoint(sub.endpoint)) return 'gone';
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(msg),
          { vapidDetails: { subject, publicKey: pub, privateKey: priv }, TTL: 12 * 3600, urgency: 'normal', timeout: 8000 },
        );
        return 'ok';
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        return status === 404 || status === 410 ? 'gone' : 'error';
      }
    },
  };
}
