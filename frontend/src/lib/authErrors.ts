import { AuthErrorCodes } from 'firebase/auth'

/** Firebase's error `code` strings, with a plain-language message for each one
 * a person can actually do something about. Anything else gets a generic line
 * rather than the SDK's raw text ("Firebase: Error (auth/...)"), which reads as
 * a bug report. */
const MESSAGES: Record<string, string> = {
  [AuthErrorCodes.INVALID_LOGIN_CREDENTIALS]: 'That email and password do not match.',
  [AuthErrorCodes.INVALID_PASSWORD]: 'That email and password do not match.',
  [AuthErrorCodes.USER_DELETED]: 'That email and password do not match.',
  [AuthErrorCodes.EMAIL_EXISTS]: 'An account with that email already exists. Try signing in instead.',
  [AuthErrorCodes.WEAK_PASSWORD]: 'Choose a stronger password.',
  [AuthErrorCodes.INVALID_EMAIL]: 'Enter a valid email address.',
  [AuthErrorCodes.USER_DISABLED]: 'This account has been disabled.',
  [AuthErrorCodes.TOO_MANY_ATTEMPTS_TRY_LATER]: 'Too many attempts. Wait a few minutes and try again.',
  [AuthErrorCodes.NETWORK_REQUEST_FAILED]: 'Could not reach the sign-in service. Check your connection and try again.',
  [AuthErrorCodes.POPUP_BLOCKED]: 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
  [AuthErrorCodes.CREDENTIAL_TOO_OLD_LOGIN_AGAIN]: 'For your security, sign in again and retry.',
  [AuthErrorCodes.CREDENTIAL_ALREADY_IN_USE]: 'That Google account is already linked to a different HireLoom account.',
}

/** Codes meaning the person closed the Google window, not that anything failed. */
const CANCELLED = new Set<string>([
  AuthErrorCodes.POPUP_CLOSED_BY_USER,
  AuthErrorCodes.EXPIRED_POPUP_REQUEST,
])

export function errorCode(err: unknown): string | null {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string'
    ? (err as { code: string }).code
    : null
}

export function isCancelled(err: unknown): boolean {
  const code = errorCode(err)
  return code !== null && CANCELLED.has(code)
}

export function needsRecentLogin(err: unknown): boolean {
  return errorCode(err) === AuthErrorCodes.CREDENTIAL_TOO_OLD_LOGIN_AGAIN
}

export function friendlyAuthError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const code = errorCode(err)
  if (code && MESSAGES[code]) return MESSAGES[code]
  return fallback
}
