import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { studentReportsService } from '@/services/studentReports'
import type { StudentReportPage } from '@/services/studentReports'
import type { StudentReport, StudentReportWithStudent } from '@/types/database'

export const STUDENT_REPORTS_KEY = 'student-reports'
export const ADMIN_UNREAD_REPORTS_KEY = [STUDENT_REPORTS_KEY, 'admin', 'unread-count'] as const

interface RealtimeUnreadRow {
  id?: string
  admin_unread?: boolean
}

function updateCachedAdminReport(queryClient: QueryClient, report: StudentReport) {
  queryClient.setQueriesData<StudentReportPage<StudentReportWithStudent>>(
    {
      queryKey: [STUDENT_REPORTS_KEY, 'admin'],
      predicate: query => typeof query.queryKey[2] === 'object',
    },
    page => page ? {
      ...page,
      rows: page.rows.map(row => row.id === report.id ? { ...row, ...report } : row),
    } : page,
  )
}

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
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function useAdminUnreadComplaintCount(enabled = true, subscribe = true) {
  const queryClient = useQueryClient()
  const pendingDelta = useRef(0)
  const query = useQuery({
    queryKey: ADMIN_UNREAD_REPORTS_KEY,
    queryFn: studentReportsService.getAdminUnreadCount,
    enabled,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  useEffect(() => {
    if (!enabled || !subscribe) return

    const channel = supabase
      .channel('admin-student-reports')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'student_reports' },
        payload => {
          const oldRow = payload.old as RealtimeUnreadRow
          const newRow = payload.new as RealtimeUnreadRow
          const wasUnread = payload.eventType !== 'INSERT' && oldRow.admin_unread === true
          const isUnread = payload.eventType !== 'DELETE' && newRow.admin_unread === true
          const delta = Number(isUnread) - Number(wasUnread)

          if (delta !== 0) {
            const current = queryClient.getQueryData<number>(ADMIN_UNREAD_REPORTS_KEY)
            if (current === undefined) {
              pendingDelta.current += delta
            } else {
              queryClient.setQueryData(ADMIN_UNREAD_REPORTS_KEY, Math.max(0, current + delta))
            }
          }

          if (payload.eventType === 'UPDATE' && newRow.id) {
            queryClient.setQueriesData<StudentReportPage<StudentReportWithStudent>>(
              {
                queryKey: [STUDENT_REPORTS_KEY, 'admin'],
                predicate: cachedQuery => typeof cachedQuery.queryKey[2] === 'object',
              },
              page => page ? {
                ...page,
                rows: page.rows.map(row => row.id === newRow.id ? { ...row, ...payload.new } : row),
              } : page,
            )
          }

          if (payload.eventType === 'INSERT') toast.info('New complaint received')
        },
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [enabled, queryClient, subscribe])

  useEffect(() => {
    if (query.data === undefined || pendingDelta.current === 0) return
    const delta = pendingDelta.current
    pendingDelta.current = 0
    queryClient.setQueryData<number>(
      ADMIN_UNREAD_REPORTS_KEY,
      current => Math.max(0, (current ?? query.data) + delta),
    )
  }, [query.data, queryClient])

  return query
}

export function useSolveStudentReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: studentReportsService.markSolved,
    onSuccess: report => {
      updateCachedAdminReport(queryClient, report)
      toast.success('Complaint marked as solved')
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

export function useMarkStudentReportRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: studentReportsService.markRead,
    onSuccess: report => updateCachedAdminReport(queryClient, report),
    onError: (error: Error) => toast.error(error.message),
  })
}
