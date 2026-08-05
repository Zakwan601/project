import type { AttendanceStatus } from '@/types/database'

export const attendanceStatusLabels: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  excused: 'Approved leave',
}

export function attendanceStatusLabel(status: AttendanceStatus) {
  return attendanceStatusLabels[status]
}
