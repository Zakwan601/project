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
  finePerAbsentDay: number
  fineRecordedAbsences: number
  fineLateDays: number
  latePenaltyAbsences: number
  fineableAbsences: number
  attendanceFine: number
  examMissedCount: number
  examMissedFineAmount: number
  examMissedFine: number
  totalFine: number
  className: string | null
  classGrade: string | null
  classSection: string | null
}

export interface StudentFineDetails {
  recordedAbsences: number
  lateDays: number
  latePenaltyAbsences: number
  fineableAbsences: number
  finePerAbsentDay: number
  attendanceFine: number
  examMissedCount: number
  examMissedFineAmount: number
  examMissedFine: number
  totalFine: number
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
    const [statisticsResponse, fineResponse] = await Promise.all([
      db.rpc('get_student_attendance_statistics', { p_student_id: studentId }),
      db.rpc('get_student_attendance_fine_details', {
        p_student_id: studentId,
        p_start_date: null,
        p_end_date: null,
      }),
    ])
    if (statisticsResponse.error) throw statisticsResponse.error
    if (fineResponse.error) throw fineResponse.error
    const statistics = statisticsResponse.data as StudentAttendanceStatistics
    const fine = fineResponse.data as StudentFineDetails
    return {
      ...statistics,
      stats: {
        ...statistics.stats,
        finePerAbsentDay: fine.finePerAbsentDay,
        fineRecordedAbsences: fine.recordedAbsences,
        fineLateDays: fine.lateDays,
        latePenaltyAbsences: fine.latePenaltyAbsences,
        fineableAbsences: fine.fineableAbsences,
        attendanceFine: fine.attendanceFine,
        examMissedCount: fine.examMissedCount,
        examMissedFineAmount: fine.examMissedFineAmount,
        examMissedFine: fine.examMissedFine,
        totalFine: fine.totalFine,
      },
    }
  },

  async getFineDetails(studentId: string, startDate?: string, endDate?: string): Promise<StudentFineDetails> {
    const { data, error } = await db.rpc('get_student_attendance_fine_details', {
      p_student_id: studentId,
      p_start_date: startDate ?? null,
      p_end_date: endDate ?? null,
    })
    if (error) throw error
    return data as StudentFineDetails
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
        absent: dayRecs.filter(r => r.status === 'absent' || r.status === 'too_late').length,
        late: dayRecs.filter(r => r.status === 'late').length,
      }
    })
  },
}
