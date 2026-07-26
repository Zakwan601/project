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

export function useDashboardPunches(admissionNumber?: string) {
  return useQuery({
    queryKey: [DEVICE_LOGS_KEY, 'dashboard', admissionNumber ?? 'all'],
    queryFn: () => deviceLogsService.getDashboardPunches(admissionNumber),
    refetchInterval: 60_000,
  })
}
