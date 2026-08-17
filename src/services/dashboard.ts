// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { supabase } from '@/lib/supabase'
import type { DashboardStats } from '@/types/database'
import { format } from 'date-fns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export const dashboardService = {
  async getStats(): Promise<DashboardStats> {
    const today = format(new Date(), 'yyyy-MM-dd')

    const [
      { count: totalStudents },
      { count: totalClasses },
    ] = await Promise.all([
      db.from('students').select('*', { count: 'exact', head: true }).eq('is_active', true),
      db.from('classes').select('*', { count: 'exact', head: true }).eq('is_active', true),
    ])

    const { data: todaySessions } = await db
      .from('attendance_sessions')
      .select('id')
      .eq('date', today)

    const sessionIds = (todaySessions as Array<{ id: string }> ?? []).map(s => s.id)

    let presentToday = 0
    let absentToday = 0
    let lateToday = 0
    let excusedToday = 0

    if (sessionIds.length > 0) {
      const { data: records } = await db
        .from('attendance_records')
        .select('status')
        .in('session_id', sessionIds)

      const recs = (records ?? []) as Array<{ status: string }>
      presentToday = recs.filter(r => r.status === 'present').length
      absentToday = recs.filter(r => r.status === 'absent').length
      lateToday = recs.filter(r => r.status === 'late').length
      excusedToday = recs.filter(r => r.status === 'excused').length
    }

    const totalToday = presentToday + absentToday + lateToday
    const todayAttendanceRate = totalToday > 0 ? Math.round(((presentToday + lateToday) / totalToday) * 100) : 0

    return {
      totalStudents: totalStudents ?? 0,
      totalClasses: totalClasses ?? 0,
      todayAttendanceRate,
      presentToday,
      absentToday,
      lateToday,
      excusedToday,
    }
  },

  async getWeeklyAttendance() {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      return format(d, 'yyyy-MM-dd')
    })

    const results = await Promise.all(
      days.map(async (date) => {
        const { data: sessions } = await db
          .from('attendance_sessions')
          .select('id')
          .eq('date', date)

        const sessionIds = ((sessions ?? []) as Array<{ id: string }>).map(s => s.id)
        if (sessionIds.length === 0) return { date, present: 0, absent: 0, late: 0 }

        const { data: records } = await db
          .from('attendance_records')
          .select('status')
          .in('session_id', sessionIds)

        const recs = (records ?? []) as Array<{ status: string }>
        return {
          date,
          present: recs.filter(r => r.status === 'present').length,
          absent: recs.filter(r => r.status === 'absent').length,
          late: recs.filter(r => r.status === 'late').length,
        }
      })
    )
    return results
  },
}
