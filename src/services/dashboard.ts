// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { supabase } from '@/lib/supabase'
import type { DashboardStats } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export interface WeeklyAttendanceDay {
  date: string
  present: number
  absent: number
  late: number
}

export interface AdminDashboardData {
  stats: DashboardStats
  weekly: WeeklyAttendanceDay[]
}

export const dashboardService = {
  async getDashboard(
    today: string,
    weeklyStart: string,
    weeklyEnd: string,
  ): Promise<AdminDashboardData> {
    const { data, error } = await db.rpc('get_admin_dashboard', {
      p_today: today,
      p_weekly_start: weeklyStart,
      p_weekly_end: weeklyEnd,
    })

    if (error) throw error
    return data as AdminDashboardData
  },
}
