import { useQuery } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { dashboardService } from '@/services/dashboard'

export const ADMIN_DASHBOARD_KEY = 'admin_dashboard'

export function useAdminDashboard() {
  const today = new Date()
  const weeklyEnd = format(today, 'yyyy-MM-dd')
  const weeklyStart = format(subDays(today, 6), 'yyyy-MM-dd')

  return useQuery({
    queryKey: [ADMIN_DASHBOARD_KEY, weeklyStart, weeklyEnd],
    queryFn: () => dashboardService.getDashboard(weeklyEnd, weeklyStart, weeklyEnd),
  })
}
