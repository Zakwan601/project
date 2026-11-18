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

export interface DailyPresenceCounts {
  students: number
  present: number
  late: number
  absent: number
  excused: number
  unmarked: number
  rate: number | null
}
export interface ClassDailyPresence extends DailyPresenceCounts {
  class_id: string | null
  class_name: string
  section: string
  session_id: string | null
  session_name: string
}
export interface SessionDailyPresence extends DailyPresenceCounts {
  session_id: string | null
  session_name: string
}
export interface AdminDailyPresenceData {
  date: string
  classes: ClassDailyPresence[]
  sessions: SessionDailyPresence[]
}

export const dashboardService = {
  async getDailyPresence(date: string): Promise<AdminDailyPresenceData> {
    const { data, error } = await db.rpc('get_admin_daily_presence', { p_date: date })
    if (error) throw error
    return data as AdminDailyPresenceData
  },
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
