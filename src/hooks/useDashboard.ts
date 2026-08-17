import { useQuery } from '@tanstack/react-query'
import { dashboardService } from '@/services/dashboard'

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard_stats'],
    queryFn: () => dashboardService.getStats(),
    refetchInterval: 60_000,
  })
}

export function useWeeklyAttendance() {
  return useQuery({
    queryKey: ['weekly_attendance'],
    queryFn: () => dashboardService.getWeeklyAttendance(),
    refetchInterval: 300_000,
  })
}
