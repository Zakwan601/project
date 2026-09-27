import { useQuery } from '@tanstack/react-query'
import { studentDashboardService } from '@/services/studentDashboard'

const attendanceStatisticsQuery = (studentId: string | undefined) => ({
  queryKey: ['student_attendance_statistics', studentId] as const,
  queryFn: () => studentDashboardService.getAttendanceStatistics(studentId!),
  enabled: !!studentId,
  staleTime: Infinity,
  refetchOnMount: false as const,
  refetchOnWindowFocus: false as const,
  refetchOnReconnect: false as const,
})

export function useStudentDashboardStats(studentId: string | undefined) {
  return useQuery({
    ...attendanceStatisticsQuery(studentId),
    select: data => data.stats,
  })
}

export function useStudentFineDetails(studentId: string | undefined, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['student_attendance_fine_details', studentId, startDate ?? 'all', endDate ?? 'all'],
    queryFn: () => studentDashboardService.getFineDetails(studentId!, startDate, endDate),
    enabled: !!studentId,
  })
}

export function useStudentSubjectAttendance(studentId: string | undefined) {
  return useQuery({
    ...attendanceStatisticsQuery(studentId),
    select: data => data.subjects,
  })
}

export function useStudentWeeklyAttendance(studentId: string | undefined) {
  return useQuery({
    queryKey: ['student_weekly_attendance', studentId],
    queryFn: () => studentDashboardService.getWeeklyAttendance(studentId!),
    enabled: !!studentId,
    refetchInterval: 300_000,
  })
}
