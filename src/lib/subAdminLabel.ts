import type { SubAdminLabel } from '@/types/database'

export function getSubAdminLabel(label?: SubAdminLabel) {
  return label === 'teacher' ? 'Teacher' : 'Sub-administrator'
}
