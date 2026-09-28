export interface PasswordStrength {
  segments: number // 0-4, filled bars
  label: string
}

export function getPasswordStrength(password: string): PasswordStrength {
  if (!password) return { segments: 0, label: '' }

  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1
  if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score += 1

  const labels = ['Too short', 'Weak password', 'Good password', 'Strong password', 'Strong password']
  return { segments: Math.max(1, score), label: labels[score] }
}
