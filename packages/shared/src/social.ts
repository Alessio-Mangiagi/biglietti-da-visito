import type { SocialNetwork } from './contact';

const HOSTS: Array<[RegExp, SocialNetwork]> = [
  [/(^|\.)linkedin\.com$/i, 'linkedin'],
  [/(^|\.)instagram\.com$/i, 'instagram'],
  [/(^|\.)(facebook|fb)\.com$/i, 'facebook'],
  [/(^|\.)(twitter|x)\.com$/i, 'x'],
  [/(^|\.)(youtube\.com|youtu\.be)$/i, 'youtube'],
  [/(^|\.)github\.com$/i, 'github'],
  [/(^|\.)tiktok\.com$/i, 'tiktok'],
];

export function hostOf(url: string): string | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

export function detectNetwork(url: string): SocialNetwork | null {
  const host = hostOf(url);
  if (!host) return null;
  for (const [re, net] of HOSTS) if (re.test(host)) return net;
  return null;
}

export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  youtube: 'YouTube',
  github: 'GitHub',
  tiktok: 'TikTok',
  other: 'Altro',
};

const SAFE_SCHEMES = /^(https?|mailto|tel):/i;

/**
 * Absolute URL for links built from untrusted text (OCR, imported vCards, QR codes).
 * Only web, mail and phone schemes survive: "javascript:…", "data:…" and the like are
 * neutralised by turning them into a harmless https URL.
 */
export function toHref(url: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const u = url.trim().replace(/[\u0000-\u001f\u007f\s]+/g, '');
  if (SAFE_SCHEMES.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return `https://${encodeURIComponent(u)}`;
  return `https://${u}`;
}
