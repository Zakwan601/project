import { useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { studentsService } from '@/services/students'
import type { Student, StudentWithClass } from '@/types/database'
import { toast } from 'sonner'
import { ADMIN_DASHBOARD_KEY } from '@/hooks/useDashboard'

import { STUDENTS_KEY, studentListKey, studentDetailKey, studentPeriodKey, studentCacheOptions } from '@/lib/studentQueryCache'
export { STUDENTS_KEY } from '@/lib/studentQueryCache'

export function useStudents(classId?: string) {
  const { user, accessScope, loading } = useAuth()
  const select = useCallback((students: StudentWithClass[]) => classId ? students.filter(student => student.class_id === classId) : students, [classId])
  return useQuery({
    ...studentCacheOptions,
    queryKey: studentListKey(user?.id ?? '', accessScope ?? ''),
    queryFn: ({ signal }) => studentsService.getAll(undefined, signal),
    enabled: Boolean(user && accessScope && !loading),
    select,
  })
}

export function useStudent(id: string) {
  const { user, accessScope, loading } = useAuth()
  const qc = useQueryClient()
  const listKey = studentListKey(user?.id ?? '', accessScope ?? '')
  return useQuery({
    ...studentCacheOptions,
    queryKey: studentDetailKey(user?.id ?? '', accessScope ?? '', id),
    queryFn: ({ signal }) => studentsService.getById(id, signal),
    enabled: Boolean(id && user && accessScope && !loading),
    initialData: () => {
      const list = qc.getQueryState<StudentWithClass[]>(listKey)
      return list?.isInvalidated ? undefined : list?.data?.find(student => student.id === id)
    },
    initialDataUpdatedAt: () => qc.getQueryState(listKey)?.dataUpdatedAt,
  })
}

// Historical enrollment is separate from today's list, but shares invalidation.
export function useStudentsForPeriod(classId: string, startDate: string, endDate = startDate, activeOnly = false) {
  const { user, accessScope, loading } = useAuth()
  const select = useCallback((students: Student[]) => activeOnly ? students.filter(student => student.is_active) : students, [activeOnly])
  return useQuery({
    ...studentCacheOptions,
    queryKey: studentPeriodKey(user?.id ?? '', accessScope ?? '', classId, startDate, endDate),
    queryFn: ({ signal }) => studentsService.getByClassForPeriod(classId, startDate, endDate, signal),
    enabled: Boolean(classId && startDate && user && accessScope && !loading),
    select,
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
      void qc.invalidateQueries({ queryKey: [ADMIN_DASHBOARD_KEY] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useAssignStudentsToClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ studentIds, targetClassId, effectiveDate }: {
      studentIds: string[]
      targetClassId: string
      effectiveDate: string
    }) => studentsService.assignClass(studentIds, targetClassId, effectiveDate),
    onSuccess: count => {
      qc.invalidateQueries({ queryKey: [STUDENTS_KEY] })
      qc.invalidateQueries({ queryKey: ['classes'] })
      qc.invalidateQueries({ queryKey: ['student-enrollment-history'] })
      qc.invalidateQueries({ queryKey: [ADMIN_DASHBOARD_KEY] })
      toast.success(count === 0
        ? 'Selected students are already in this class'
        : `${count} student${count === 1 ? '' : 's'} assigned to class`)
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
