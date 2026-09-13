import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { holidaysService } from '@/services/holidays'
import type { Holiday } from '@/types/database'
import { toast } from 'sonner'

export const HOLIDAYS_KEY = 'holidays'

export function useHolidays(startDate?: string, endDate?: string, classId?: string) {
  return useQuery({
    queryKey: [HOLIDAYS_KEY, { startDate, endDate, classId }],
    queryFn: () => holidaysService.getAll(startDate, endDate, classId),
  })
}

export function useCreateHoliday() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (h: Omit<Holiday, 'id' | 'created_at' | 'updated_at' | 'created_by'>) =>
      holidaysService.create(h),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [HOLIDAYS_KEY] })
      toast.success('Holiday added')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateHoliday() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Holiday> }) =>
      holidaysService.update(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [HOLIDAYS_KEY] })
      toast.success('Holiday updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteHoliday() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => holidaysService.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [HOLIDAYS_KEY] })
      toast.success('Holiday deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
