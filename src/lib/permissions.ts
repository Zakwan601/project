import type { PermissionKey } from '@/types/database'

export interface PermissionDefinition {
  key: PermissionKey
  label: string
  description: string
  supportsWrite: boolean
}

export const permissionDefinitions: PermissionDefinition[] = [
  { key: 'dashboard', label: 'Dashboard', description: 'School-wide dashboard totals and trends', supportsWrite: false },
  { key: 'students', label: 'Students', description: 'Student profiles, enrollment history, and promotions', supportsWrite: true },
  { key: 'classes', label: 'Classes', description: 'Classes, subjects, and class configuration', supportsWrite: true },
  { key: 'attendance', label: 'Attendance', description: 'Daily attendance and manual corrections', supportsWrite: true },
  { key: 'punches', label: 'Punches', description: 'Biometric punch records', supportsWrite: false },
  { key: 'reports', label: 'Reports', description: 'Attendance analytics and exports', supportsWrite: false },
  { key: 'results', label: 'Student Results', description: 'Exams, marks, publishing, and guardian links', supportsWrite: true },
  { key: 'vacations', label: 'Vacations', description: 'School vacation dates', supportsWrite: true },
  { key: 'departure_anomalies', label: 'Departure Anomalies', description: 'Departure analysis reports', supportsWrite: true },
  { key: 'devices', label: 'Devices', description: 'Biometric device status and details', supportsWrite: false },
  { key: 'sms_messages', label: 'SMS Messages', description: 'Outbound SMS delivery history', supportsWrite: false },
  { key: 'complaints', label: 'Complaints', description: 'Student complaints and resolution status', supportsWrite: true },
  { key: 'announcements', label: 'Announcements', description: 'Student-facing school notices', supportsWrite: true },
]
