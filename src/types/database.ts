export type UserRole = 'admin' | 'sub_admin' | 'student'

export type PermissionKey =
  | 'dashboard'
  | 'students'
  | 'classes'
  | 'attendance'
  | 'punches'
  | 'reports'
  | 'vacations'
  | 'departure_anomalies'
  | 'devices'
  | 'sms_messages'
  | 'complaints'
  | 'announcements'

export interface SubAdminPermission {
  profile_id: string
  permission_key: PermissionKey
  can_read: boolean
  can_write: boolean
  created_at: string
  updated_at: string
}
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused'
export type SessionType = 'morning' | 'afternoon' | 'period' | 'full_day'
export type AttendanceSource = 'manual' | 'biometric' | 'system'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Omit<Profile, 'created_at' | 'updated_at'>
        Update: Partial<Omit<Profile, 'id' | 'created_at'>>
      }
      sub_admin_permissions: {
        Row: SubAdminPermission
        Insert: Omit<SubAdminPermission, 'created_at' | 'updated_at'>
        Update: Partial<Pick<SubAdminPermission, 'can_read' | 'can_write'>>
      }
      academic_years: {
        Row: AcademicYear
        Insert: Omit<AcademicYear, 'id' | 'created_at'>
        Update: Partial<Omit<AcademicYear, 'id' | 'created_at'>>
      }
      classes: {
        Row: Class
        Insert: Omit<Class, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Class, 'id' | 'created_at'>>
      }
      students: {
        Row: Student
        Insert: Omit<Student, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Student, 'id' | 'created_at'>>
      }
      student_enrollments: {
        Row: StudentEnrollment
        Insert: Omit<StudentEnrollment, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<StudentEnrollment, 'id' | 'student_id' | 'created_at'>>
      }
      subjects: {
        Row: Subject
        Insert: Omit<Subject, 'id' | 'created_at'>
        Update: Partial<Omit<Subject, 'id' | 'created_at'>>
      }
      attendance_sessions: {
        Row: AttendanceSession
        Insert: Omit<AttendanceSession, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<AttendanceSession, 'id' | 'created_at'>>
      }
      attendance_records: {
        Row: AttendanceRecord
        Insert: Omit<AttendanceRecord, 'id' | 'created_at'>
        Update: Partial<Omit<AttendanceRecord, 'id' | 'created_at'>>
      }
      devices: {
        Row: Device
        Insert: Omit<Device, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Device, 'id' | 'created_at'>>
      }
      device_logs: {
        Row: DeviceLog
        Insert: Omit<DeviceLog, 'id' | 'created_at'>
        Update: Partial<Omit<DeviceLog, 'id' | 'created_at'>>
      }
      student_reports: {
        Row: StudentReport
        Insert: Omit<StudentReport, 'id' | 'status' | 'admin_read_at' | 'discord_delivered' | 'created_at' | 'updated_at'>
        Update: Partial<Pick<StudentReport, 'status' | 'admin_read_at'>>
      }
      sms_messages: {
        Row: SmsMessage
        Insert: Omit<SmsMessage, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<SmsMessage, 'id' | 'created_at'>>
      }
      announcements: {
        Row: Announcement
        Insert: Omit<Announcement, 'id' | 'is_active' | 'created_by' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Announcement, 'id' | 'created_at'>>
      }
    }
    Enums: {
      user_role: UserRole
      attendance_status: AttendanceStatus
      session_type: SessionType
      attendance_source: AttendanceSource
    }
  }
}

export interface Profile {
  id: string
  role: UserRole
  full_name: string
  avatar_url: string | null
  phone: string | null
  address: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AcademicYear {
  id: string
  name: string
  start_date: string
  end_date: string
  is_current: boolean
  created_at: string
}

export interface Class {
  id: string
  name: string
  grade: string
  section: string
  academic_year_id: string | null
  capacity: number
  room: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ClassWithDetails extends Class {
  academic_years: AcademicYear | null
  active_student_count?: number
}

export interface Student {
  id: string
  profile_id: string | null
  admission_number: string
  class_id: string | null
  roll_number: number | null
  first_name: string
  last_name: string
  guardian_phone: string | null
  date_of_admission: string
  biometric_id: string | null
  photo_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface StudentWithClass extends Student {
  classes: Class | null
}

export type EnrollmentStatus = 'active' | 'promoted' | 'transferred' | 'withdrawn'

export interface StudentEnrollment {
  id: string
  student_id: string
  academic_year_id: string
  class_id: string
  roll_number: number | null
  started_on: string
  ended_on: string | null
  status: EnrollmentStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface StudentEnrollmentWithDetails extends StudentEnrollment {
  classes: Pick<Class, 'id' | 'name' | 'grade' | 'section'>
  academic_years: AcademicYear
}

export interface Subject {
  id: string
  name: string
  code: string
  class_id: string | null
  is_active: boolean
  created_at: string
}

export interface AttendanceSession {
  id: string
  class_id: string
  subject_id: string | null
  date: string
  session_type: SessionType
  taken_by: string | null
  source: AttendanceSource
  is_finalized: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface AttendanceSessionWithDetails extends AttendanceSession {
  classes: Class
  subjects: Subject | null
  profiles: Profile | null
}

export interface AttendanceRecord {
  id: string
  session_id: string
  student_id: string
  status: AttendanceStatus
  biometric_verified: boolean
  remarks: string | null
  marked_at: string
  check_in_at: string | null
  check_out_at: string | null
  manually_corrected: boolean
  corrected_by: string | null
  corrected_at: string | null
  correction_reason: string | null
  created_at: string
}

export interface AttendanceRecordWithStudent extends AttendanceRecord {
  students: Student
}

export interface Device {
  id: string
  device_serial: string
  name: string
  location: string | null
  ip_address: string | null
  port: number | null
  model: string | null
  is_active: boolean
  last_sync_at: string | null
  created_at: string
  updated_at: string
  sn: string
  alias: string | null
  firmware_version: string | null
  push_version: string | null
  area: string | null
  user_count: number
  fingerprint_count: number
  face_count: number
  palm_count: number
  transaction_count: number
  last_activity: string | null
  push_time: string | null
  transfer_interval: string | null
  attendance_status: string | null
  device_state: string | null
  is_online: boolean
  raw_data: Record<string, unknown> | null
  synced_at: string | null
}

export interface DeviceLog {
  id: string
  device_id: string | null
  student_biometric_id: string
  punched_at: string
  processed: boolean
  attendance_record_id: string | null
  raw_data: Record<string, unknown> | null
  created_at: string | null
}

export interface DeviceLogWithDevice extends DeviceLog {
  devices: {
    id: string
    name: string
    sn: string
    device_serial: string
    alias: string | null
  } | null
}

export interface DashboardPunch extends DeviceLog {
  student: Pick<
    Student,
    'admission_number' | 'first_name' | 'last_name' | 'photo_url'
  > | null
}

// Dashboard stats types
export interface DashboardStats {
  totalStudents: number
  totalClasses: number
  todayAttendanceRate: number
  presentToday: number
  absentToday: number
  lateToday: number
  excusedToday: number
}

export type SyncServiceStatus = 'never' | 'running' | 'success' | 'failed'

export interface SyncServiceHealth {
  service_key: string
  process_started_at: string
  last_heartbeat_at: string
  last_sync_started_at: string | null
  last_sync_at: string | null
  last_sync_status: SyncServiceStatus
  last_error: string | null
  updated_at: string
  is_running: boolean
}

export type StudentReportCategory = 'attendance' | 'academic' | 'safety' | 'technical' | 'other'
export type StudentReportStatus = 'submitted' | 'reviewed' | 'resolved'

export interface StudentReport {
  id: string
  student_id: string
  category: StudentReportCategory
  subject: string
  message: string
  status: StudentReportStatus
  admin_read_at: string | null
  discord_delivered: boolean
  created_at: string
  updated_at: string
}

export interface StudentReportWithStudent extends StudentReport {
  students: Pick<Student, 'first_name' | 'last_name' | 'admission_number'>
}

export type SmsMessageStatus = 'queued' | 'processing' | 'submitted' | 'delivered' | 'failed'

export interface SmsMessage {
  id: string
  user_id: string | null
  recipient: string
  sender_id: string
  message: string
  message_type: string
  scheduled_at: string | null
  provider_message_id: string | null
  status: SmsMessageStatus
  provider_status_code: number | null
  provider_status_text: string | null
  submitted_at: string | null
  delivered_at: string | null
  failed_at: string | null
  send_response: Record<string, unknown> | null
  latest_dlr: Record<string, unknown> | null
  created_at: string
  updated_at: string
  source: string | null
  attendance_record_id: string | null
  student_id: string | null
}

// Holiday types
export interface Holiday {
  id: string
  date: string
  name: string
  description: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Announcement {
  id: string
  title: string
  message: string
  expires_at: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}
