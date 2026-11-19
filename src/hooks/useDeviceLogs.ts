import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
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
  search = '',
  admissionNumber,
  classId,
  source = 'current',
  date,
  page,
  pageSize,
  enabled = true,
}: {
  search?: string
  admissionNumber?: string
  classId?: string
  source?: 'current' | 'archive'
  date?: string
  page: number
  pageSize: number
  enabled?: boolean
}) {
  const normalizedSearch = search.trim()
  const [debouncedSearch, setDebouncedSearch] = useState(normalizedSearch)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(normalizedSearch), 300)
    return () => window.clearTimeout(timer)
  }, [normalizedSearch])
  return useQuery({
    queryKey: [DEVICE_LOGS_KEY, 'daily-page', {
      admissionNumber: admissionNumber ?? 'all',
      classId: classId ?? 'all',
      source,
      date: date || 'all',
      search: debouncedSearch,
      page,
      pageSize,
    }],
    queryFn: ({ signal }) => deviceLogsService.getDailyPunchesPage({
      search: debouncedSearch,
      admissionNumber,
      classId,
      source,
      date,
      page,
      pageSize,
      signal,
    }),
    enabled: enabled && normalizedSearch === debouncedSearch,
    placeholderData: previousData => previousData,
    refetchInterval: source === 'current' ? 60_000 : false,
    refetchIntervalInBackground: false,
  })
}
