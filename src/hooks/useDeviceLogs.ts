import { useQuery } from '@tanstack/react-query'
import { deviceLogsService } from '@/services/deviceLogs'

export const DEVICE_LOGS_KEY = 'device-logs'

export function useStudentPunches(admissionNumber: string | null) {
  return useQuery({
    queryKey: [DEVICE_LOGS_KEY, { admissionNumber }],
    queryFn: () => deviceLogsService.getByAdmissionNumber(admissionNumber!),
    enabled: Boolean(admissionNumber),
  })
}

export function useDashboardPunches(admissionNumber?: string, enabled = true) {
  return useQuery({
    queryKey: [DEVICE_LOGS_KEY, 'dashboard', admissionNumber ?? 'all'],
    queryFn: () => deviceLogsService.getDashboardPunches(admissionNumber),
    enabled,
    refetchInterval: 60_000,
  })
}

export function useDailyPunchesPage({
  admissionNumber,
  date,
  page,
  pageSize,
  enabled = true,
}: {
  admissionNumber?: string
  date?: string
  page: number
  pageSize: number
  enabled?: boolean
}) {
  return useQuery({
    queryKey: [DEVICE_LOGS_KEY, 'daily-page', {
      admissionNumber: admissionNumber ?? 'all',
      date: date || 'all',
      page,
      pageSize,
    }],
    queryFn: () => deviceLogsService.getDailyPunchesPage({
      admissionNumber,
      date,
      page,
      pageSize,
    }),
    enabled,
    placeholderData: previousData => previousData,
    refetchInterval: 60_000,
  })
}
