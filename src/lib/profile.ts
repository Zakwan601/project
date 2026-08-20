import type { Profile, Student } from '@/types/database'

function compactPhone(value: string) {
  return value.replace(/[\s()-]/g, '')
}

export function isValidBangladeshMobile(value: string | null | undefined) {
  if (!value) return false
  return /^(?:\+?88)?01[3-9]\d{8}$/.test(compactPhone(value))
}

export function normalizeBangladeshMobile(value: string) {
  const phone = compactPhone(value)
  if (phone.startsWith('+8801')) return phone
  if (phone.startsWith('8801')) return `+${phone}`
  if (phone.startsWith('01')) return `+88${phone}`
  return phone
}

export function isProfileComplete(profile: Profile | null | undefined, student?: Student | null) {
  if (profile?.role === 'student') {
    return Boolean(
      student
        && isValidBangladeshMobile(student.guardian_phone),
    )
  }

  return Boolean(
    profile
      && isValidBangladeshMobile(profile.phone),
  )
}
