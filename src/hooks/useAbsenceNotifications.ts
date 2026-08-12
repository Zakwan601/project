import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { absenceNotificationsService } from '@/services/absenceNotifications'

const ABSENCE_NOTIFICATION_STATUS_KEY = 'absence-notification-status'

export function useAbsenceNotificationStatus(date: string, enabled: boolean) {
  return useQuery({
    queryKey: [ABSENCE_NOTIFICATION_STATUS_KEY, date],
    queryFn: () => absenceNotificationsService.getStatus(date),
    enabled: enabled && Boolean(date),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useSendAbsenceNotifications() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { date: string }) => {
      const status = await absenceNotificationsService.getStatus(input.date)
      if (status.hasSentMessage) {
        throw new Error('Absence SMS messages have already been sent for this date.')
      }
      if (status.hasMessageInProgress) {
        throw new Error('Absence SMS messages are already being processed for this date.')
      }
      return absenceNotificationsService.send(input)
    },
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
