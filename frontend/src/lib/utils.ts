import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** The URL if it is safe to use as an external link (http(s), a host, no
 *  embedded credentials), otherwise null. Anything rendered as an href from
 *  data the app did not write itself goes through this: a javascript: URL
 *  from a crawled job board would otherwise run in the app when clicked. */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value.trim())
    const ok = (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname) && !url.username && !url.password
    return ok ? url.toString() : null
  } catch {
    return null
  }
}
