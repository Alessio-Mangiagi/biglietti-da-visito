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

/** Absolute URL for links; keeps explicit schemes, adds https:// otherwise. */
export function toHref(url: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
}
