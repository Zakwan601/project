import { useQuery } from '@tanstack/react-query'
import { smsMessagesService } from '@/services/smsMessages'
import type { SmsMessageStatus } from '@/types/database'

export const SMS_MESSAGES_KEY = 'sms-messages'

export function useSmsMessages({
  page,
  pageSize,
  status,
  date,
}: {
  page: number
  pageSize: number
  status: SmsMessageStatus | 'all'
  date: string
}) {
  return useQuery({
    queryKey: [SMS_MESSAGES_KEY, { page, pageSize, status, date }],
    queryFn: () => smsMessagesService.getPage({ page, pageSize, status, date }),
    placeholderData: previousData => previousData,
    refetchInterval: 30_000,
  })
}
