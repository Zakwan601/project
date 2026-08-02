import { useQuery } from '@tanstack/react-query'
import { smsMessagesService } from '@/services/smsMessages'
import type { SmsMessageStatus } from '@/types/database'

export const SMS_MESSAGES_KEY = 'sms-messages'

export function useSmsMessages({
  page,
  pageSize,
  status,
}: {
  page: number
  pageSize: number
  status: SmsMessageStatus | 'all'
}) {
  return useQuery({
    queryKey: [SMS_MESSAGES_KEY, { page, pageSize, status }],
    queryFn: () => smsMessagesService.getPage({ page, pageSize, status }),
    placeholderData: previousData => previousData,
    refetchInterval: 30_000,
  })
}
