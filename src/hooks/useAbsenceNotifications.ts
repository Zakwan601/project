import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { absenceNotificationsService } from '@/services/absenceNotifications'

const ABSENCE_NOTIFICATION_STATUS_KEY = 'absence-notification-status'
const ABSENCE_NOTIFICATION_STATUS_REFRESH_INTERVAL = 2 * 60 * 1000

export function useAbsenceNotificationStatus(date: string, enabled: boolean) {
  return useQuery({
    queryKey: [ABSENCE_NOTIFICATION_STATUS_KEY, date],
    queryFn: () => absenceNotificationsService.getStatus(date),
    enabled: enabled && Boolean(date),
    staleTime: 60_000,
    refetchInterval: ABSENCE_NOTIFICATION_STATUS_REFRESH_INTERVAL,
  })
}

export function useSendAbsenceNotifications() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: absenceNotificationsService.send,
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: [ABSENCE_NOTIFICATION_STATUS_KEY] })
      const submitted = result.submitted ?? 0
      const skipped = result.skipped ?? 0
      toast.success(
        typeof result.message === 'string'
          ? result.message
          : `${submitted} absence SMS submitted${skipped > 0 ? `; ${skipped} already processed or skipped` : ''}${result.discord_sent ? '; Discord updated' : ''}.`,
      )
    },
    onError: (error: Error) => toast.error(error.message),
  })
}
