import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsService } from '@/services/students'
import type { Student } from '@/types/database'
import { toast } from 'sonner'

export const STUDENTS_KEY = 'students'

export function useStudents(classId?: string) {
  return useQuery({
    queryKey: [STUDENTS_KEY, { classId }],
    queryFn: () => studentsService.getAll(classId),
  })
}

export function useStudent(id: string) {
  return useQuery({
    queryKey: [STUDENTS_KEY, id],
    queryFn: () => studentsService.getById(id),
    enabled: !!id,
  })
}

export function useCreateStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (s: Omit<Student, 'id' | 'created_at' | 'updated_at'>) => studentsService.create(s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [STUDENTS_KEY] })
      toast.success('Student created successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Student> }) =>
      studentsService.update(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [STUDENTS_KEY] })
      toast.success('Student updated successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => studentsService.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [STUDENTS_KEY] })
      toast.success('Student deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
