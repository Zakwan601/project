import { useQuery } from '@tanstack/react-query'
import { studentDashboardService } from '@/services/studentDashboard'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'

// The handwritten database types do not include this narrow relationship query.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export function useStudentIdentity() {
  const { user, role } = useAuth()

  return useQuery({
    queryKey: ['my_student_identity', user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from('students')
        .select('id, admission_number')
        .eq('profile_id', user!.id)
        .maybeSingle()

      if (error) throw error
      return data as { id: string; admission_number: string } | null
    },
    enabled: Boolean(user?.id && role === 'student'),
  })
}

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
