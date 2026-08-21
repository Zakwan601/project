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

export interface StudentAttendanceStatistics {
  stats: StudentDashboardStats
  subjects: SubjectAttendance[]
}

export interface WeeklyAttendanceDay {
  date: string
  present: number
  absent: number
  late: number
}

export const studentDashboardService = {
  async getAttendanceStatistics(studentId: string): Promise<StudentAttendanceStatistics> {
    const { data, error } = await db.rpc('get_student_attendance_statistics', {
      p_student_id: studentId,
    })

    if (error) throw error
    return data as StudentAttendanceStatistics
  },

  async getWeeklyAttendance(studentId: string): Promise<WeeklyAttendanceDay[]> {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = subDays(new Date(), i)
      return format(d, 'yyyy-MM-dd')
    })

    const { data: records, error } = await db
      .from('attendance_records')
      .select('status, attendance_sessions!inner(date)')
      .eq('student_id', studentId)
      .in('attendance_sessions.date', days)

    if (error) throw error
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
