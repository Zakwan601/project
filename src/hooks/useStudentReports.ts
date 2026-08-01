import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { studentReportsService } from '@/services/studentReports'

export const STUDENT_REPORTS_KEY = 'student-reports'

export function useMyStudentReports(page: number, pageSize: number) {
  return useQuery({
    queryKey: [STUDENT_REPORTS_KEY, 'mine', { page, pageSize }],
    queryFn: () => studentReportsService.getMinePage(page, pageSize),
    placeholderData: previousData => previousData,
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

export function useAdminStudentReports({
  page,
  pageSize,
  enabled = true,
}: {
  page: number
  pageSize: number
  enabled?: boolean
}) {
  return useQuery({
    queryKey: [STUDENT_REPORTS_KEY, 'admin', { page, pageSize }],
    queryFn: () => studentReportsService.getAdminPage(page, pageSize),
    enabled,
    placeholderData: previousData => previousData,
    refetchInterval: 30_000,
  })
}

export function useAdminUnreadComplaintCount(enabled = true, subscribe = true) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled || !subscribe) return

    const channel = supabase
      .channel('admin-student-reports')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'student_reports' },
        payload => {
          queryClient.invalidateQueries({ queryKey: [STUDENT_REPORTS_KEY, 'admin'] })
          if (payload.eventType === 'INSERT') toast.info('New complaint received')
        },
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [enabled, queryClient, subscribe])

  return useQuery({
    queryKey: [STUDENT_REPORTS_KEY, 'admin', 'unread-count'],
    queryFn: studentReportsService.getAdminUnreadCount,
    enabled,
    refetchInterval: 30_000,
  })
}

export function useSolveStudentReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: studentReportsService.markSolved,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [STUDENT_REPORTS_KEY, 'admin'] })
      toast.success('Complaint marked as solved')
    },
    onError: (error: Error) => toast.error(error.message),
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
