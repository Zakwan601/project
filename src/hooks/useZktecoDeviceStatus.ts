import { useQuery } from '@tanstack/react-query'
import { fetchZktecoDeviceStatus } from '@/services/zktecoStatus'

export const ZKTECO_STATUS_KEY = ['zkteco-device-status'] as const
export const ZKTECO_STATUS_REFRESH_INTERVAL = 10 * 60 * 1000

export function useZktecoDeviceStatus({ poll = false }: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: ZKTECO_STATUS_KEY,
    queryFn: fetchZktecoDeviceStatus,
    refetchInterval: poll ? ZKTECO_STATUS_REFRESH_INTERVAL : false,
    staleTime: ZKTECO_STATUS_REFRESH_INTERVAL,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}
