import { useQuery } from '@tanstack/react-query'
import { format, parseISO, subDays } from 'date-fns'
import { splitBangladeshDateTime } from '@/lib/dateTime'
import { dashboardService } from '@/services/dashboard'

export const ADMIN_DASHBOARD_KEY = 'admin_dashboard'

export function useAdminDashboard() {
  const weeklyEnd = splitBangladeshDateTime(new Date()).date
  const weeklyStart = format(subDays(parseISO(weeklyEnd), 6), 'yyyy-MM-dd')

  return useQuery({
    queryKey: [ADMIN_DASHBOARD_KEY, weeklyStart, weeklyEnd],
    queryFn: () => dashboardService.getDashboard(weeklyEnd, weeklyStart, weeklyEnd),
    refetchInterval: 60_000,
  })
}

export function useAdminDailyPresence(date: string) {
  return useQuery({
    queryKey: [ADMIN_DASHBOARD_KEY, 'daily-presence', date],
    queryFn: () => dashboardService.getDailyPresence(date),
    refetchInterval: 60_000,
  })
}
