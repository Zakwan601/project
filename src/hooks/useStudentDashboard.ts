import { useQuery } from '@tanstack/react-query'
import { studentDashboardService } from '@/services/studentDashboard'

export function useStudentDashboardStats(studentId: string | undefined) {
  return useQuery({
    queryKey: ['student_dashboard_stats', studentId],
    queryFn: () => studentDashboardService.getStats(studentId!),
    enabled: !!studentId,
    refetchInterval: 60_000,
  })
}

export function useStudentSubjectAttendance(studentId: string | undefined) {
  return useQuery({
    queryKey: ['student_subject_attendance', studentId],
    queryFn: () => studentDashboardService.getSubjectAttendance(studentId!),
    enabled: !!studentId,
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
