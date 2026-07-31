import { supabase } from '@/lib/supabase'
import type {
  AttendanceSession,
  AttendanceSessionWithDetails,
  AttendanceRecord,
  AttendanceRecordWithStudent,
  AttendanceStatus,
} from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export const attendanceService = {
  async getSessions(classId?: string, date?: string) {
    let query = db
      .from('attendance_sessions')
      .select(`*, classes(id, name, grade, section), subjects(id, name, code), profiles(id, full_name)`)
      .order('date', { ascending: false })

    if (classId) query = query.eq('class_id', classId)
    if (date) query = query.eq('date', date)

    const { data, error } = await query
    if (error) throw error
    return data as AttendanceSessionWithDetails[]
  },

  async getSessionById(id: string) {
    const { data, error } = await db
      .from('attendance_sessions')
      .select(`*, classes(id, name, grade, section), subjects(id, name, code), profiles(id, full_name)`)
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return data as AttendanceSessionWithDetails | null
  },

  async createSession(session: Omit<AttendanceSession, 'id' | 'created_at' | 'updated_at'>) {
    const { data, error } = await db
      .from('attendance_sessions')
      .insert(session)
      .select()
      .single()
    if (error) throw error
    return data as AttendanceSession
  },

  async finalizeSession(id: string) {
    const { data, error } = await db
      .from('attendance_sessions')
      .update({ is_finalized: true })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data as AttendanceSession
  },

  async getRecordsBySession(sessionId: string) {
    const { data, error } = await db
      .from('attendance_records')
      .select('*, students(id, first_name, last_name, admission_number, roll_number, photo_url)')
      .eq('session_id', sessionId)
    if (error) throw error
    return data as AttendanceRecordWithStudent[]
  },

  async upsertRecord(record: {
    session_id: string
    student_id: string
    status: AttendanceStatus
    remarks?: string
    biometric_verified?: boolean
  }) {
    const { data, error } = await db
      .from('attendance_records')
      .upsert(
        { ...record, marked_at: new Date().toISOString() },
        { onConflict: 'session_id,student_id' }
      )
      .select()
      .single()
    if (error) throw error
    return data as AttendanceRecord
  },

  async bulkUpsertRecords(records: Array<{
    session_id: string
    student_id: string
    status: AttendanceStatus
    remarks?: string
  }>) {
    const { data, error } = await db
      .from('attendance_records')
      .upsert(
        records.map(r => ({ ...r, marked_at: new Date().toISOString() })),
        { onConflict: 'session_id,student_id' }
      )
      .select()
    if (error) throw error
    return data as AttendanceRecord[]
  },

  async getDailyStats(date: string) {
    const { data } = await db
      .from('attendance_records')
      .select('status, attendance_sessions!inner(date)')
      .eq('attendance_sessions.date', date)
    const records = (data ?? []) as Array<{ status: string }>
    const present = records.filter(r => r.status === 'present').length
    const absent = records.filter(r => r.status === 'absent').length
    const late = records.filter(r => r.status === 'late').length
    const excused = records.filter(r => r.status === 'excused').length
    const total = records.length
    return { present, absent, late, excused, total }
  },

  async getStudentAttendanceSummary(studentId: string, startDate?: string, endDate?: string) {
    let query = db
      .from('attendance_records')
      .select('status, attendance_sessions(date)')
      .eq('student_id', studentId)

    if (startDate) query = query.gte('attendance_sessions.date', startDate)
    if (endDate) query = query.lte('attendance_sessions.date', endDate)

    const { data } = await query
    const records = (data ?? []) as Array<{ status: string }>
    const present = records.filter(r => r.status === 'present').length
    const total = records.length
    return { present, absent: total - present, total, percentage: total > 0 ? Math.round((present / total) * 100) : 0 }
  },

  async syncDailyAttendance(date: string) {
    const { data, error } = await supabase.functions.invoke('sync-attendance', {
      body: { date },
    })
    if (error) throw error
    return data as {
      date: string
      sessions_created: number
      absent_records_created: number
      attendance_records_synced: number
      device_logs_processed: number
      device_logs_unmatched: number
    }
  },

  async markDateAsVacation(date: string, name: string, description?: string) {
    const { data, error } = await db.rpc('mark_attendance_vacation', {
      p_date: date,
      p_name: name,
      p_description: description || null,
    })
    if (error) throw error
    return data as {
      date: string
      holiday_id: string
      sessions_removed: number
    }
  },
}
