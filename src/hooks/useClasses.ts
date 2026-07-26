import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { classesService } from '@/services/classes'
import type { Class } from '@/types/database'
import { toast } from 'sonner'

export const CLASSES_KEY = 'classes'

export function useClasses(academicYearId?: string) {
  return useQuery({
    queryKey: [CLASSES_KEY, { academicYearId }],
    queryFn: () => classesService.getAll(academicYearId),
  })
}

export function useClass(id: string) {
  return useQuery({
    queryKey: [CLASSES_KEY, id],
    queryFn: () => classesService.getById(id),
    enabled: !!id,
  })
}

export function useCreateClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: Omit<Class, 'id' | 'created_at' | 'updated_at'>) => classesService.create(c),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CLASSES_KEY] })
      toast.success('Class created successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Class> }) =>
      classesService.update(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CLASSES_KEY] })
      toast.success('Class updated successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => classesService.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CLASSES_KEY] })
      toast.success('Class deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
