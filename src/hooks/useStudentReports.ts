import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { studentReportsService } from '@/services/studentReports'

export const STUDENT_REPORTS_KEY = 'student-reports'

export function useMyStudentReports() {
  return useQuery({
    queryKey: [STUDENT_REPORTS_KEY, 'mine'],
    queryFn: () => studentReportsService.getMine(),
  })
}

export function useSubmitStudentReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: studentReportsService.submit,
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: [STUDENT_REPORTS_KEY] })
      toast.success('Report sent to the administration')
      if (!data.discord_delivered) {
        toast.warning('The report was saved, but Discord delivery is not configured or failed')
      }
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

export function useAdminStudentReports() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const channel = supabase
      .channel('admin-student-reports')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'student_reports' },
        payload => {
          queryClient.invalidateQueries({ queryKey: [STUDENT_REPORTS_KEY, 'admin'] })
          if (payload.eventType === 'INSERT') toast.info('New student report received')
        },
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [queryClient])

  return useQuery({
    queryKey: [STUDENT_REPORTS_KEY, 'admin'],
    queryFn: () => studentReportsService.getAdminRecent(),
    refetchInterval: 30_000,
  })
}

export function useMarkStudentReportRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: studentReportsService.markRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [STUDENT_REPORTS_KEY, 'admin'] }),
    onError: (error: Error) => toast.error(error.message),
  })
}
