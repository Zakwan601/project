import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsService } from '@/services/students'
import type { Student } from '@/types/database'
import { toast } from 'sonner'
import { ADMIN_DASHBOARD_KEY } from '@/hooks/useDashboard'

export const STUDENTS_KEY = 'students'
const STUDENTS_STALE_TIME = 10 * 60 * 1000

export function useStudents(classId?: string) {
  return useQuery({
    queryKey: [STUDENTS_KEY, { classId }],
    queryFn: () => studentsService.getAll(classId),
    staleTime: STUDENTS_STALE_TIME,
  })
}

export function useStudent(id: string) {
  return useQuery({
    queryKey: [STUDENTS_KEY, id],
    queryFn: () => studentsService.getById(id),
    enabled: !!id,
    staleTime: STUDENTS_STALE_TIME,
  })
}

export function useCreateStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (s: Omit<Student, 'id' | 'created_at' | 'updated_at'>) => studentsService.create(s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [STUDENTS_KEY] })
      qc.invalidateQueries({ queryKey: [ADMIN_DASHBOARD_KEY] })
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
      qc.invalidateQueries({ queryKey: [ADMIN_DASHBOARD_KEY] })
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
      qc.invalidateQueries({ queryKey: [ADMIN_DASHBOARD_KEY] })
      toast.success('Student deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function usePromoteStudents() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ studentIds, targetClassId, effectiveDate }: {
      studentIds: string[]
      targetClassId: string
      effectiveDate: string
    }) => studentsService.promote(studentIds, targetClassId, effectiveDate),
    onSuccess: count => {
      qc.invalidateQueries({ queryKey: [STUDENTS_KEY] })
      qc.invalidateQueries({ queryKey: ['classes'] })
      qc.invalidateQueries({ queryKey: ['student-enrollment-history'] })
      toast.success(`${count} student${count === 1 ? '' : 's'} promoted`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useStudentEnrollmentHistory(studentId?: string) {
  return useQuery({
    queryKey: ['student-enrollment-history', studentId],
    queryFn: () => studentsService.getEnrollmentHistory(studentId!),
    enabled: Boolean(studentId),
  })
}
