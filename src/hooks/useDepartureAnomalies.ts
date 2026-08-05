import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { departureAnomaliesService } from '@/services/departureAnomalies'

const REPORT_KEY = 'departure-anomaly-report'

export function useSavedDepartureAnalysis(classId: string, date: string) {
  return useQuery({
    queryKey: [REPORT_KEY, classId, date],
    queryFn: () => departureAnomaliesService.getSaved(classId, date),
    enabled: Boolean(classId && date),
    staleTime: 30_000,
    retry: false,
  })
}

export function useAnalyzeDepartureAnomalies() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: departureAnomaliesService.analyze,
    onSuccess: (result, input) => {
      queryClient.setQueryData([REPORT_KEY, input.class_id, input.date], result)
    },
  })
}
