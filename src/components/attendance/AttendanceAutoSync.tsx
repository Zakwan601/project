import { useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { attendanceService } from '@/services/attendance'
import { RECORDS_KEY, SESSIONS_KEY } from '@/hooks/useAttendance'

export function AttendanceAutoSync() {
  const { user, profile, loading } = useAuth()
  const queryClient = useQueryClient()
  const lastSyncKey = useRef<string | null>(null)

  useEffect(() => {
    if (loading || !user || !profile?.is_active) return

    const today = format(new Date(), 'yyyy-MM-dd')
    const syncKey = `${user.id}:${today}`
    if (lastSyncKey.current === syncKey) return
    lastSyncKey.current = syncKey

    attendanceService.syncDailyAttendance(today)
      .then(async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: [SESSIONS_KEY] }),
          queryClient.invalidateQueries({ queryKey: [RECORDS_KEY] }),
          queryClient.invalidateQueries({ queryKey: ['daily_stats'] }),
          queryClient.invalidateQueries({ queryKey: ['my-attendance'] }),
          queryClient.invalidateQueries({ queryKey: ['student-daily-attendance'] }),
          queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] }),
          queryClient.invalidateQueries({ queryKey: ['weekly_attendance'] }),
          queryClient.invalidateQueries({ queryKey: ['device-logs'] }),
        ])
      })
      .catch(error => {
        // Keep navigation uninterrupted; the manual Sync Attendance button
        // remains available if an automatic sync fails.
        console.error('Automatic daily attendance sync failed:', error)
      })
  }, [loading, profile?.is_active, queryClient, user])

  return null
}
