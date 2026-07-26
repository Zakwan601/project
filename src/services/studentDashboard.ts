// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { supabase } from '@/lib/supabase'
import { format, subDays } from 'date-fns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export interface StudentDashboardStats {
  attendanceRate: number
  presentCount: number
  absentCount: number
  lateCount: number
  excusedCount: number
  totalSessions: number
  className: string | null
  classGrade: string | null
  classSection: string | null
}

export interface SubjectAttendance {
  subject: string
  present: number
  late: number
  absent: number
  excused: number
  total: number
  percentage: number
}

export interface WeeklyAttendanceDay {
  date: string
  present: number
  absent: number
  late: number
}

export const studentDashboardService = {
  async getStats(studentId: string): Promise<StudentDashboardStats> {
    const { data: student } = await db
      .from('students')
      .select('class_id, classes(id, name, grade, section)')
      .eq('id', studentId)
      .maybeSingle()

    const cls = student?.classes
    const className = cls?.name ?? null
    const classGrade = cls?.grade ?? null
    const classSection = cls?.section ?? null

    const { data: records } = await db
      .from('attendance_records')
      .select('status, attendance_sessions!inner(date)')
      .eq('student_id', studentId)

    const recs = (records ?? []) as Array<{ status: string }>
    const presentCount = recs.filter(r => r.status === 'present').length
    const lateCount = recs.filter(r => r.status === 'late').length
    const absentCount = recs.filter(r => r.status === 'absent').length
    const excusedCount = recs.filter(r => r.status === 'excused').length
    const totalSessions = recs.length
    const attendanceRate = totalSessions > 0
      ? Math.round(((presentCount + lateCount) / totalSessions) * 100)
      : 0

    return {
      attendanceRate,
      presentCount,
      absentCount,
      lateCount,
      excusedCount,
      totalSessions,
      className,
      classGrade,
      classSection,
    }
  },

  async getSubjectAttendance(studentId: string): Promise<SubjectAttendance[]> {
    const { data: records } = await db
      .from('attendance_records')
      .select('status, attendance_sessions!inner(subject_id, notes, subjects(id, name))')
      .eq('student_id', studentId)

    const bySubject: Record<string, SubjectAttendance> = {}
    ;(records ?? []).forEach((r: { status: string; attendance_sessions: { notes: string | null; subjects: { name: string } | null } }) => {
      const session = r.attendance_sessions
      if (!session) return
      const subjectName = session.subjects?.name ?? session.notes ?? 'General'
      if (!bySubject[subjectName]) {
        bySubject[subjectName] = { subject: subjectName, present: 0, late: 0, absent: 0, excused: 0, total: 0, percentage: 0 }
      }
      const entry = bySubject[subjectName]
      const status = r.status as 'present' | 'late' | 'absent' | 'excused'
      entry[status]++
      entry.total++
    })

    return Object.values(bySubject).map(row => ({
      ...row,
      percentage: row.total > 0 ? Math.round(((row.present + row.late) / row.total) * 100) : 0,
    })).sort((a, b) => b.percentage - a.percentage)
  },

  async getWeeklyAttendance(studentId: string): Promise<WeeklyAttendanceDay[]> {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = subDays(new Date(), 6 - i)
      return format(d, 'yyyy-MM-dd')
    })

    const { data: records } = await db
      .from('attendance_records')
      .select('status, attendance_sessions!inner(date)')
      .eq('student_id', studentId)
      .in('attendance_sessions.date', days)

    const recs = (records ?? []) as Array<{ status: string; attendance_sessions: { date: string } }>

    return days.map(date => {
      const dayRecs = recs.filter(r => r.attendance_sessions?.date === date)
      return {
        date,
        present: dayRecs.filter(r => r.status === 'present').length,
        absent: dayRecs.filter(r => r.status === 'absent').length,
        late: dayRecs.filter(r => r.status === 'late').length,
      }
    })
  },
}
