import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { attendanceService } from '@/services/attendance'
import type { AttendanceStatus } from '@/types/database'
import { toast } from 'sonner'

export const SESSIONS_KEY = 'attendance_sessions'
export const RECORDS_KEY = 'attendance_records'

export function useAttendanceSessions(classId?: string, date?: string) {
  return useQuery({
    queryKey: [SESSIONS_KEY, { classId, date }],
    queryFn: () => attendanceService.getSessions(classId, date),
  })
}

export function useAttendanceSession(id: string) {
  return useQuery({
    queryKey: [SESSIONS_KEY, id],
    queryFn: () => attendanceService.getSessionById(id),
    enabled: !!id,
  })
}

export function useAttendanceRecords(sessionId: string) {
  return useQuery({
    queryKey: [RECORDS_KEY, sessionId],
    queryFn: () => attendanceService.getRecordsBySession(sessionId),
    enabled: !!sessionId,
  })
}

export function useCreateSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: attendanceService.createSession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [SESSIONS_KEY] })
      toast.success('Attendance session created')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useMarkAttendance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (r: { session_id: string; student_id: string; status: AttendanceStatus; remarks?: string }) =>
      attendanceService.upsertRecord(r),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [RECORDS_KEY, vars.session_id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useBulkMarkAttendance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: attendanceService.bulkUpsertRecords,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [RECORDS_KEY] })
      qc.invalidateQueries({ queryKey: [SESSIONS_KEY] })
      toast.success('Attendance saved successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useFinalizeSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => attendanceService.finalizeSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [SESSIONS_KEY] })
      toast.success('Session finalized')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDailyStats(date: string) {
  return useQuery({
    queryKey: ['daily_stats', date],
    queryFn: () => attendanceService.getDailyStats(date),
  })
}

export function useSyncDailyAttendance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: string) => attendanceService.syncDailyAttendance(date),
    onSuccess: data => {
      qc.invalidateQueries({ queryKey: [RECORDS_KEY] })
      qc.invalidateQueries({ queryKey: [SESSIONS_KEY] })
      qc.invalidateQueries({ queryKey: ['daily_stats'] })
      qc.invalidateQueries({ queryKey: ['my-attendance'] })
      qc.invalidateQueries({ queryKey: ['device-logs'] })
      toast.success(
        `Daily attendance synced: ${data.attendance_records_synced} present, ${data.device_logs_processed} punches processed`,
      )
      if (data.device_logs_unmatched > 0) {
        toast.warning(`${data.device_logs_unmatched} device logs remain unmatched`)
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useMarkAttendanceVacation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      date,
      name,
      description,
    }: {
      date: string
      name: string
      description?: string
    }) => attendanceService.markDateAsVacation(date, name, description),
    onSuccess: data => {
      qc.invalidateQueries({ queryKey: [RECORDS_KEY] })
      qc.invalidateQueries({ queryKey: [SESSIONS_KEY] })
      qc.invalidateQueries({ queryKey: ['daily_stats'] })
      qc.invalidateQueries({ queryKey: ['student_dashboard_stats'] })
      qc.invalidateQueries({ queryKey: ['student_weekly_attendance'] })
      qc.invalidateQueries({ queryKey: ['holidays'] })
      toast.success(
        data.sessions_removed > 0
          ? `Vacation added and ${data.sessions_removed} attendance sheet${data.sessions_removed === 1 ? '' : 's'} removed`
          : 'Vacation added',
      )
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
