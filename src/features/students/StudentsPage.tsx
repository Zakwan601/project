import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { Check, Copy, Download, Eye, EyeOff, GraduationCap, KeyRound, Pencil, Printer, RefreshCw, ShieldCheck, Trash2, UserCircle, X } from 'lucide-react'
import { StudentSearchInput } from '@/components/shared/StudentSearchInput'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { STUDENTS_KEY, useStudents, useUpdateStudent, useDeleteStudent, usePromoteStudents } from '@/hooks/useStudents'
import { useClasses } from '@/hooks/useClasses'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { toast } from 'sonner'
import type { AcademicYear, BloodGroup, ClassGroup, Student, StudentWithClass, SubjectCourseOption } from '@/types/database'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { isValidBangladeshMobile, normalizeBangladeshMobile } from '@/lib/profile'
import { Checkbox } from '@/components/ui/checkbox'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { syncZktecoUsers, type ZktecoSyncSummary } from '@/services/zktecoUsers'
import { ADMIN_DASHBOARD_KEY } from '@/hooks/useDashboard'
import { ProfileUploads } from '@/features/profile/ProfileUploads'
import { downloadCsv } from '@/lib/csv'

import { MoreHorizontal } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Database types are maintained manually in this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const

const studentSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  admission_number: z.string().min(1, 'Required'),
  class_id: z.string().optional(),
  class_group: z.enum(['science', 'humanities', 'business']),
  fourth_subject_id: z.string().optional(),
  optional_subject_2_id: z.string().optional(),
  group_fourth_option_id: z.string().optional(),
  roll_number: z.number().optional(),
  guardian_phone: z.string().optional().refine(
    value => !value?.trim() || isValidBangladeshMobile(value),
    'Enter a valid Bangladesh mobile number',
  ),
  biometric_id: z.string().optional(),
  father_name: z.string().trim().max(120, 'Use 120 characters or fewer').optional(),
  mother_name: z.string().trim().max(120, 'Use 120 characters or fewer').optional(),
  blood_group: z.enum(BLOOD_GROUPS).or(z.literal('')).optional(),
  secondary_phone: z.string().trim().optional().refine(
    value => !value || isValidBangladeshMobile(value),
    'Enter a valid Bangladesh mobile number',
  ),
  humanities_main_option_1_id: z.string().optional(),
  humanities_main_option_2_id: z.string().optional(),
  humanities_main_option_3_id: z.string().optional(),
  humanities_fourth_option_id: z.string().optional(),
}).refine(data => !data.fourth_subject_id || data.fourth_subject_id !== data.optional_subject_2_id, {
  message: 'Choose two different optional subjects',
  path: ['optional_subject_2_id'],
}).superRefine((data, context) => {
  if (data.class_group === 'humanities') {
    const fields = ['humanities_main_option_1_id', 'humanities_main_option_2_id', 'humanities_main_option_3_id', 'humanities_fourth_option_id'] as const
    for (const field of fields) {
      if (!data[field]) context.addIssue({ code: 'custom', message: 'Required for humanities', path: [field] })
    }
    return
  }
  if (!data.group_fourth_option_id) {
    context.addIssue({ code: 'custom', message: 'Choose a fourth subject', path: ['group_fourth_option_id'] })
  }
})
type StudentForm = z.infer<typeof studentSchema>

export function StudentsPage() {
  const { data: students, isLoading, error } = useStudents()
  const { data: classes } = useClasses()
  const { data: academicSessions = [] } = useQuery<AcademicYear[]>({
    queryKey: ['academic_years'],
    queryFn: async () => {
      const { data, error } = await db.from('academic_years').select('*')
        .order('start_date', { ascending: false })
      if (error) throw error
      return data as AcademicYear[]
    },
  })
  const { data: courseOptions = [] } = useQuery<SubjectCourseOption[]>({
    queryKey: ['subject-course-options'],
    queryFn: async () => {
      const { data, error } = await db.from('subject_course_options').select('*')
        .eq('is_active', true).order('name')
      if (error) throw error
      return data as SubjectCourseOption[]
    },
  })
  const updateStudent = useUpdateStudent()
  const deleteStudent = useDeleteStudent()
  const promoteStudents = usePromoteStudents()
  const queryClient = useQueryClient()
  const { session, role, can } = useAuth()
  const canWriteStudents = can('students', 'write')
  const isFullAdmin = role === 'admin'

  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('all')
  const [academicSessionFilter, setAcademicSessionFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editing, setEditing] = useState<StudentWithClass | null>(null)
  const [accountStudent, setAccountStudent] = useState<StudentWithClass | null>(null)
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])
  const [promotionOpen, setPromotionOpen] = useState(false)
  const [targetClassId, setTargetClassId] = useState('')
  const [promotionDate, setPromotionDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [isSyncingUsers, setIsSyncingUsers] = useState(false)
  const [syncSummary, setSyncSummary] = useState<ZktecoSyncSummary | null>(null)

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<StudentForm>({
    resolver: zodResolver(studentSchema),
    mode: 'onChange',
  })

  const classId = watch('class_id')
  const classGroup = watch('class_group')
  const humanitiesOptions = courseOptions.filter(option => option.class_group === 'humanities')
  const groupFourthOptions = courseOptions.filter(option => option.class_group === classGroup)
  const groupFourthOptionId = watch('group_fourth_option_id')
  const humanitiesMain1 = watch('humanities_main_option_1_id')
  const humanitiesMain2 = watch('humanities_main_option_2_id')
  const humanitiesMain3 = watch('humanities_main_option_3_id')
  const humanitiesFourth = watch('humanities_fourth_option_id')
  const humanitiesSelectionIds = [humanitiesMain1, humanitiesMain2, humanitiesMain3, humanitiesFourth].filter(Boolean)
  const guardianPhone = watch('guardian_phone')
  const secondaryPhone = watch('secondary_phone')
  const bloodGroup = watch('blood_group')

  const filtered = students?.filter(student => {
    const matchesSearch = `${student.first_name} ${student.last_name} ${student.admission_number}`
      .toLowerCase()
      .includes(search.toLowerCase())
    const matchesClass = classFilter === 'all'
      || (classFilter === 'unassigned' ? !student.class_id : student.class_id === classFilter)

    const matchesSession = academicSessionFilter === 'all'
      || classes?.some(cls => cls.id === student.class_id && cls.academic_year_id === academicSessionFilter)

    return matchesSearch && matchesClass && matchesSession
  }) ?? []
  const selectedClassDetails = classes?.find(currentClass => currentClass.id === classFilter)
  const selectedClassGroupLabel = selectedClassDetails?.class_group === 'business'
    ? 'Business Studies'
    : selectedClassDetails?.class_group === 'science'
      ? 'Science'
      : selectedClassDetails?.class_group === 'humanities'
        ? 'Humanities'
        : ''
  const studentListTitle = selectedClassDetails
    ? selectedClassDetails.name + ' - Section ' + selectedClassDetails.section + ' - ' + selectedClassGroupLabel
    : ''
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * pageSize
  const pageStudents = filtered.slice(pageStart, pageStart + pageSize)
  const allPageSelected = pageStudents.length > 0 && pageStudents.every(student => selectedStudentIds.includes(student.id))
  const somePageSelected = pageStudents.some(student => selectedStudentIds.includes(student.id))

  useEffect(() => {
    setPage(1)
    setSelectedStudentIds([])
  }, [search, classFilter, academicSessionFilter])

  useEffect(() => {
    setPage(currentPage)
  }, [currentPage])

  const toggleStudent = (studentId: string, checked: boolean) => {
    setSelectedStudentIds(current => checked
      ? [...new Set([...current, studentId])]
      : current.filter(id => id !== studentId))
  }

  const exportStudentList = () => {
    if (!selectedClassDetails || filtered.length === 0) return

    const rows = filtered.map(student => [
      (student.first_name + ' ' + student.last_name).trim(),
      student.roll_number,
      student.guardian_phone,
    ])
    const classSlug = (selectedClassDetails.name + '-' + selectedClassDetails.section + '-' + selectedClassDetails.class_group)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')

    downloadCsv('students-' + classSlug + '.csv', [
      [studentListTitle, '', ''],
      ['Name', 'Roll', "Parent's Number"],
      ...rows,
    ])
  }

  const printStudentList = () => {
    if (!selectedClassDetails || filtered.length === 0) return

    const pageStyle = document.createElement('style')
    pageStyle.id = 'student-list-page-style'
    pageStyle.textContent = '@page { size: A4 portrait; margin: 12mm; }'
    document.head.appendChild(pageStyle)

    const cleanup = () => {
      document.body.classList.remove('student-report-printing')
      pageStyle.remove()
    }

    document.body.classList.add('student-report-printing')
    window.addEventListener('afterprint', cleanup, { once: true })
    window.print()
  }

  const submitPromotion = async () => {
    if (!targetClassId || selectedStudentIds.length === 0) return
    await promoteStudents.mutateAsync({
      studentIds: selectedStudentIds,
      targetClassId,
      effectiveDate: promotionDate,
    })
    setPromotionOpen(false)
    setSelectedStudentIds([])
    setTargetClassId('')
  }

  const selectPromotionTarget = (classId: string) => {
    setTargetClassId(classId)
    const targetClass = classes?.find(cls => cls.id === classId)
    const targetSession = targetClass?.academic_years
    if (targetSession) {
      const today = format(new Date(), 'yyyy-MM-dd')
      setPromotionDate(
        today < targetSession.start_date
          ? targetSession.start_date
          : today > targetSession.end_date
            ? targetSession.end_date
            : today,
      )
    }
  }

  const syncUsers = async () => {
    setIsSyncingUsers(true)
    try {
      const summary = await syncZktecoUsers()
      setSyncSummary(summary)
      await queryClient.invalidateQueries({ queryKey: [STUDENTS_KEY] })
      if (summary.created > 0) {
        await queryClient.invalidateQueries({ queryKey: [ADMIN_DASHBOARD_KEY] })
      }

      if (summary.received === 0) {
        toast.info('No new ZKTeco users found.')
      } else if (summary.failed > 0 || summary.acknowledgementFailed > 0) {
        toast.warning('ZKTeco sync completed with some issues')
      } else {
        toast.success('ZKTeco users synchronized successfully')
      }
    } catch (syncError) {
      toast.error((syncError as Error).message)
    } finally {
      setIsSyncingUsers(false)
    }
  }

  const refreshEditingStudent = async (studentId: string) => {
    const { data, error } = await db
      .from('students')
      .select('*, classes(id, name, grade, section)')
      .eq('id', studentId)
      .single()
    if (error) throw error
    setEditing(data as StudentWithClass)
    await queryClient.invalidateQueries({ queryKey: [STUDENTS_KEY] })
  }

  const openEdit = (s: StudentWithClass) => {
    setEditing(s)
    reset({
      first_name: s.first_name,
      last_name: s.last_name,
      admission_number: s.admission_number,
      class_id: s.class_id ?? undefined,
      class_group: s.class_group,
      fourth_subject_id: s.fourth_subject_id ?? undefined,
      optional_subject_2_id: s.optional_subject_2_id ?? undefined,
      group_fourth_option_id: s.group_fourth_option_id ?? undefined,
      humanities_main_option_1_id: s.humanities_main_option_1_id ?? undefined,
      humanities_main_option_2_id: s.humanities_main_option_2_id ?? undefined,
      humanities_main_option_3_id: s.humanities_main_option_3_id ?? undefined,
      humanities_fourth_option_id: s.humanities_fourth_option_id ?? undefined,
      roll_number: s.roll_number ?? undefined,
      guardian_phone: s.guardian_phone ?? undefined,
      biometric_id: s.biometric_id ?? undefined,
      father_name: s.father_name ?? '',
      mother_name: s.mother_name ?? '',
      blood_group: s.blood_group ?? '',
      secondary_phone: s.secondary_phone ?? '',
    })
    setDialogOpen(true)
  }

  const onSubmit = async (data: StudentForm) => {
    const payload: Partial<Student> = {
      first_name: data.first_name,
      last_name: data.last_name,
      admission_number: data.admission_number,
      class_id: data.class_id || null,
      class_group: data.class_group,
      fourth_subject_id: null,
      optional_subject_2_id: null,
      group_fourth_option_id: data.class_group === 'humanities' ? null : data.group_fourth_option_id || null,
      humanities_main_option_1_id: data.class_group === 'humanities' ? data.humanities_main_option_1_id || null : null,
      humanities_main_option_2_id: data.class_group === 'humanities' ? data.humanities_main_option_2_id || null : null,
      humanities_main_option_3_id: data.class_group === 'humanities' ? data.humanities_main_option_3_id || null : null,
      humanities_fourth_option_id: data.class_group === 'humanities' ? data.humanities_fourth_option_id || null : null,
      roll_number: data.roll_number ?? null,
      guardian_phone: data.guardian_phone?.trim() || null,
      biometric_id: data.biometric_id || null,
      father_name: data.father_name?.trim() || null,
      mother_name: data.mother_name?.trim() || null,
      blood_group: (data.blood_group || null) as BloodGroup | null,
      secondary_phone: data.secondary_phone ? normalizeBangladeshMobile(data.secondary_phone) : null,
    }

    if (!editing) return
    if (isFullAdmin && editing.profile_id) {
      const { error } = await db
        .from('profiles')
        .update({
          full_name: `${data.first_name.trim()} ${data.last_name.trim()}`.trim(),
          father_name: data.father_name?.trim() || null,
          mother_name: data.mother_name?.trim() || null,
          blood_group: (data.blood_group || null) as BloodGroup | null,
          secondary_phone: data.secondary_phone ? normalizeBangladeshMobile(data.secondary_phone) : null,
        })
        .eq('id', editing.profile_id)
      if (error) {
        toast.error(error.message)
        return
      }
    }
    await updateStudent.mutateAsync({ id: editing.id, updates: payload })
    setDialogOpen(false)
    reset({})
  }

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState message={(error as Error).message} />

  return (
    <div className="student-report-screen">
      <PageHeader
        title="Students"
        description={`${students?.length ?? 0} students enrolled`}
        action={canWriteStudents ? (
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {isFullAdmin && <Button size="sm" variant="outline" onClick={syncUsers} disabled={isSyncingUsers}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${isSyncingUsers ? 'animate-spin' : ''}`} />
              {isSyncingUsers ? 'Syncing users...' : 'Sync ZKTeco users'}
            </Button>}
            {selectedStudentIds.length > 0 && (
              <Button size="sm" onClick={() => setPromotionOpen(true)}>
                <GraduationCap className="mr-1.5 h-4 w-4" />
                Promote ({selectedStudentIds.length})
              </Button>
            )}
          </div>
        ) : undefined}
      />

      <section aria-label="Student filters" className="mb-3 sm:mb-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <StudentSearchInput value={search} onChange={setSearch} className="sm:max-w-sm" />
            <Select value={academicSessionFilter} onValueChange={value => {
              setAcademicSessionFilter(value)
              setClassFilter('all')
              setSelectedStudentIds([])
            }}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Filter students by academic session">
                <SelectValue placeholder="All academic sessions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All academic sessions</SelectItem>
                {academicSessions.map(academicSession => (
                  <SelectItem key={academicSession.id} value={academicSession.id}>
                    {academicSession.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Filter students by class">
                <SelectValue placeholder="All classes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All classes</SelectItem>
                {academicSessionFilter === 'all' && <SelectItem value="unassigned">No class assigned</SelectItem>}
                {classes?.filter(cls => academicSessionFilter === 'all' || cls.academic_year_id === academicSessionFilter).map(currentClass => (
                  <SelectItem key={currentClass.id} value={currentClass.id}>
                    {currentClass.name} ({currentClass.grade}-{currentClass.section})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2 sm:ml-auto">
              <Button type="button" variant="outline" className="flex-1 whitespace-nowrap sm:flex-none" onClick={exportStudentList} disabled={!selectedClassDetails || filtered.length === 0}>
                <Download className="h-4 w-4" /> Export CSV
              </Button>
              <Button type="button" variant="outline" className="flex-1 whitespace-nowrap sm:flex-none" onClick={printStudentList} disabled={!selectedClassDetails || filtered.length === 0}>
                <Printer className="h-4 w-4" /> Print
              </Button>
            </div>
          </div>
      </section>

      <Card className="gap-0 overflow-hidden py-0">
        {filtered.length === 0 ? (
          <EmptyState
            title="No students found"
            description={search || classFilter !== 'all' || academicSessionFilter !== 'all'
              ? 'Try changing the search, academic session, or class filter.'
              : 'Students will appear here when synchronized.'}
          />
        ) : (
          <Table>
  <TableHeader>
    <TableRow>
      {canWriteStudents && (
        <TableHead className="w-8 px-2 sm:w-10 sm:px-3">
          <Checkbox
            checked={allPageSelected ? true : somePageSelected ? 'indeterminate' : false}
            onCheckedChange={checked =>
              setSelectedStudentIds(current => checked === true
                ? [...new Set([...current, ...pageStudents.map(student => student.id)])]
                : current.filter(id => !pageStudents.some(student => student.id === id)))
            }
            aria-label="Select all students on this page"
          />
        </TableHead>
      )}

      <TableHead className="px-2 text-xs sm:px-3 sm:text-sm">
        Name
      </TableHead>

      <TableHead className="px-2 text-xs sm:px-3 sm:text-sm">
        Roll No.
      </TableHead>

      <TableHead className="px-2 text-xs sm:px-3 sm:text-sm">
        Class
      </TableHead>

      <TableHead className="px-2 text-xs sm:px-3 sm:text-sm">
        Guardian Phone
      </TableHead>

      <TableHead className="px-2 text-xs sm:px-3 sm:text-sm">
        Status
      </TableHead>

      <TableHead className="px-2 text-right text-xs sm:px-3 sm:text-sm">
        Actions
      </TableHead>
    </TableRow>
  </TableHeader>

  <TableBody>
    {pageStudents.map((student, i) => (
      <motion.tr
        key={student.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: i * 0.02 }}
        className="border-b transition-colors hover:bg-muted/50"
      >
        {canWriteStudents && (
          <TableCell className="px-2 py-1.5 sm:px-3 sm:py-2">
            <Checkbox
              checked={selectedStudentIds.includes(student.id)}
              onCheckedChange={checked =>
                toggleStudent(student.id, checked === true)
              }
              aria-label={`Select ${student.first_name} ${student.last_name}`}
            />
          </TableCell>
        )}

        {/* Name */}
        <TableCell className="px-2 py-1.5 sm:px-3 sm:py-2">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <UserCircle className="h-6 w-6 shrink-0 text-muted-foreground sm:h-8 sm:w-8" />

            <div className="min-w-0">
              <p className="max-w-[110px] truncate text-xs font-medium sm:max-w-none sm:text-sm">
                {student.first_name} {student.last_name}
              </p>
            </div>
          </div>
        </TableCell>

        {/* Roll */}
        <TableCell className="px-2 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm">
          {student.roll_number ?? '—'}
        </TableCell>

        {/* Class */}
        <TableCell className="px-2 py-1.5 sm:px-3 sm:py-2">
          {student.classes ? (
            <span className="block max-w-[80px] truncate text-[10px] sm:max-w-none sm:text-sm">
              {student.classes.name}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground sm:text-sm">
              —
            </span>
          )}
          <span className="block text-[10px] text-muted-foreground">
            {student.class_group === 'business' ? 'Business Studies' : student.class_group === 'science' ? 'Science' : 'Humanities'}
          </span>
        </TableCell>

        {/* Guardian Phone */}
        <TableCell className="px-2 py-1.5 sm:px-3 sm:py-2">
          <p className="max-w-[85px] truncate text-[10px] text-muted-foreground sm:max-w-none sm:text-xs">
            {student.guardian_phone ?? '—'}
          </p>
        </TableCell>

        {/* Status */}
        <TableCell className="px-2 py-1.5 sm:px-3 sm:py-2">
          <Badge
            variant={student.is_active ? 'default' : 'secondary'}
            className="px-1.5 py-0.5 text-[9px] sm:px-2 sm:py-0.5 sm:text-xs"
          >
            {student.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </TableCell>

        {/* Actions */}
        <TableCell className="px-1 py-1.5 text-right sm:px-3 sm:py-2">
          {/* Mobile: 3-dot menu */}
          <div className={canWriteStudents || isFullAdmin ? 'flex justify-end sm:hidden' : 'hidden'}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${student.first_name} ${student.last_name}`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-48">

                {isFullAdmin && (
                  <DropdownMenuItem
                    onClick={() => setAccountStudent(student)}
                  >
                    <KeyRound className="mr-2 h-4 w-4" />
                    {student.profile_id
                      ? 'View / reset login'
                      : 'Set up login account'}
                  </DropdownMenuItem>
                )}

                {canWriteStudents && (
                  <DropdownMenuItem
                    onClick={() => openEdit(student)}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit student
                  </DropdownMenuItem>
                )}

                {canWriteStudents && (
                  <DropdownMenuItem
                    onClick={() => setDeleteId(student.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete student
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Desktop: individual action buttons */}
          <div className="hidden items-center justify-end gap-1 sm:flex">

            {isFullAdmin && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setAccountStudent(student)}
                title={
                  student.profile_id
                    ? 'View or reset login credentials'
                    : 'Set up login account'
                }
                className="text-blue-600 hover:text-blue-700"
              >
                <KeyRound className="h-3.5 w-3.5" />
              </Button>
            )}

            {canWriteStudents && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => openEdit(student)}
                title="Edit student"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}

            {canWriteStudents && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setDeleteId(student.id)}
                title="Delete student"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </TableCell>
      </motion.tr>
    ))}
  </TableBody>
</Table>
        )}
        {filtered.length > 0 && (
          <nav aria-label="Student pagination" className="flex flex-col gap-3 border-t px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Showing {pageStart + 1}–{Math.min(pageStart + pageSize, filtered.length)} of {filtered.length} students
              {selectedStudentIds.length > 0 && <span> · {selectedStudentIds.length} selected</span>}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows per page</span>
              <Select value={String(pageSize)} onValueChange={value => {
                setPageSize(Number(value))
                setPage(1)
              }}>
                <SelectTrigger className="w-20" aria-label="Students per page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map(size => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="px-1 text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>
                Next
              </Button>
            </div>
          </nav>
        )}
      </Card>

      {selectedClassDetails && filtered.length > 0 && (
        <div className="student-report-print" aria-hidden="true">
          <header className="print-report-header">
            <div>
              <h1>{studentListTitle}</h1>
              <p>Student List</p>
            </div>
            <dl>
              <dt>Students</dt>
              <dd>{filtered.length}</dd>
              <dt>Generated</dt>
              <dd>{format(new Date(), 'dd MMM yyyy, hh:mm a')}</dd>
            </dl>
          </header>

          <section className="print-summary-section">
            <table className="print-summary-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Roll</th>
                  <th>Parent's Number</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(student => (
                  <tr key={student.id}>
                    <td>{student.first_name} {student.last_name}</td>
                    <td>{student.roll_number ?? '-'}</td>
                    <td>{student.guardian_phone ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      <Dialog open={syncSummary !== null} onOpenChange={open => { if (!open) setSyncSummary(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>ZKTeco Sync Complete</DialogTitle>
            <DialogDescription>
              {syncSummary?.received === 0
                ? 'No new ZKTeco users found.'
                : 'Each device user was processed and acknowledged individually.'}
            </DialogDescription>
          </DialogHeader>
          {syncSummary && syncSummary.received > 0 && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <SyncSummaryItem label="Users received" value={syncSummary.received} />
                <SyncSummaryItem label="Users created" value={syncSummary.created} />
                <SyncSummaryItem label="Already existed" value={syncSummary.alreadyExisted} />
                <SyncSummaryItem label="Creation failed" value={syncSummary.failed} />
                <SyncSummaryItem label="Acknowledged" value={syncSummary.acknowledged} />
                <SyncSummaryItem label="Remaining pending" value={syncSummary.remainingPending} />
              </div>
              {syncSummary.acknowledgementFailed > 0 && (
                <p className="text-sm text-destructive">
                  {syncSummary.acknowledgementFailed} saved user{syncSummary.acknowledgementFailed === 1 ? ' was' : 's were'} not acknowledged and can be retried.
                </p>
              )}
              {syncSummary.errors.length > 0 && (
                <div className="max-h-32 overflow-y-auto rounded-md border bg-muted/30 p-3">
                  {syncSummary.errors.map((message, index) => (
                    <p key={`${message}-${index}`} className="text-xs text-muted-foreground">{message}</p>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" onClick={() => setSyncSummary(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={promotionOpen} onOpenChange={setPromotionOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Promote students</DialogTitle>
            <DialogDescription>
              Move {selectedStudentIds.length} selected student{selectedStudentIds.length === 1 ? '' : 's'} to the next class. Their cohort session is preserved when the target class belongs to the same session.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Target class</Label>
              <Select value={targetClassId} onValueChange={selectPromotionTarget}>
                <SelectTrigger><SelectValue placeholder="Select next class" /></SelectTrigger>
                <SelectContent>
                  {classes?.filter(cls => cls.is_active && cls.academic_year_id).map(cls => (
                    <SelectItem key={cls.id} value={cls.id}>
                      {cls.name} ({cls.grade}-{cls.section}) · {cls.academic_years?.name ?? 'Academic year'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Effective date</Label>
              <DatePickerInput
                value={promotionDate}
                onChange={setPromotionDate}
                min={classes?.find(cls => cls.id === targetClassId)?.academic_years?.start_date}
                max={classes?.find(cls => cls.id === targetClassId)?.academic_years?.end_date}
                disabled={!targetClassId}
              />
              <p className="text-xs text-muted-foreground">The date must fall within the target class's academic year.</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPromotionOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={!targetClassId || !promotionDate || promoteStudents.isPending}
              onClick={submitPromotion}
            >
              {promoteStudents.isPending ? 'Promoting...' : 'Confirm promotion'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Student</DialogTitle>
            <DialogDescription>Update student information</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="space-y-2">
                <Label>First Name *</Label>
                <Input {...register('first_name')} aria-invalid={!!errors.first_name} />
                {errors.first_name && <p className="text-xs text-destructive">{errors.first_name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Last Name *</Label>
                <Input {...register('last_name')} aria-invalid={!!errors.last_name} />
                {errors.last_name && <p className="text-xs text-destructive">{errors.last_name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Admission Number *</Label>
                <Input {...register('admission_number')} aria-invalid={!!errors.admission_number} />
                {errors.admission_number && <p className="text-xs text-destructive">{errors.admission_number.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Class</Label>
                <Select value={classId} onValueChange={v => {
                  setValue('class_id', v)
                  const nextGroup = classes?.find(c => c.id === v)?.class_group
                  if (nextGroup && nextGroup !== classGroup) {
                    setValue('class_group', nextGroup)
                    setValue('fourth_subject_id', '')
                    setValue('optional_subject_2_id', '')
                    setValue('group_fourth_option_id', '')
                    setValue('humanities_main_option_1_id', '')
                    setValue('humanities_main_option_2_id', '')
                    setValue('humanities_main_option_3_id', '')
                    setValue('humanities_fourth_option_id', '')
                  }
                }}>
                  <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                  <SelectContent>
                    {classes?.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name} ({c.grade}-{c.section})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Group *</Label>
                <Select
                  value={classGroup}
                  disabled={Boolean(classId)}
                  onValueChange={value => {
                    setValue('class_group', value as ClassGroup, { shouldValidate: true })
                    setValue('fourth_subject_id', '')
                    setValue('optional_subject_2_id', '')
                    setValue('group_fourth_option_id', '')
                    setValue('humanities_main_option_1_id', '')
                    setValue('humanities_main_option_2_id', '')
                    setValue('humanities_main_option_3_id', '')
                    setValue('humanities_fourth_option_id', '')
                  }}
                >
                  <SelectTrigger aria-invalid={!!errors.class_group}><SelectValue placeholder="Select group" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="science">Science</SelectItem>
                    <SelectItem value="humanities">Humanities</SelectItem>
                    <SelectItem value="business">Business Studies</SelectItem>
                  </SelectContent>
                </Select>
                {classId && <p className="text-xs text-muted-foreground">Group follows the assigned class.</p>}
                {errors.class_group && <p className="text-xs text-destructive">{errors.class_group.message}</p>}
              </div>
              {classGroup === 'humanities' ? (
                <div className="col-span-2 space-y-4">
                  <div>
                    <p className="text-sm font-medium">Humanities elective subjects</p>
                    <p className="text-xs text-muted-foreground">Choose three main electives and one different fourth subject. Alternative pairs cannot be combined.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {([
                      ['humanities_main_option_1_id', 'Main elective 1', humanitiesMain1],
                      ['humanities_main_option_2_id', 'Main elective 2', humanitiesMain2],
                      ['humanities_main_option_3_id', 'Main elective 3', humanitiesMain3],
                      ['humanities_fourth_option_id', 'Fourth / optional subject', humanitiesFourth],
                    ] as const).map(([field, label, current]) => {
                      const excludedGroups = humanitiesOptions.filter(option => humanitiesSelectionIds.includes(option.id) && option.id !== current).map(option => option.exclusive_group).filter(Boolean)
                      const available = humanitiesOptions.filter(option => option.id === current || (!humanitiesSelectionIds.includes(option.id) && (!option.exclusive_group || !excludedGroups.includes(option.exclusive_group))))
                      return (
                        <div key={field} className="space-y-2">
                          <Label>{label} *</Label>
                          <Select value={current || ''} onValueChange={value => setValue(field, value, { shouldValidate: true })}>
                            <SelectTrigger aria-invalid={!!errors[field]}><SelectValue placeholder="Select subject" /></SelectTrigger>
                            <SelectContent>{available.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
                          </Select>
                          {errors[field] && <p className="text-xs text-destructive">{errors[field]?.message}</p>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="col-span-2 space-y-2">
                  <Label>Fourth / optional subject *</Label>
                  <Select value={groupFourthOptionId || ''} onValueChange={value => setValue('group_fourth_option_id', value, { shouldValidate: true })}>
                    <SelectTrigger aria-invalid={!!errors.group_fourth_option_id}><SelectValue placeholder="Select subject" /></SelectTrigger>
                    <SelectContent>
                      {groupFourthOptions.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Both papers are assigned automatically from this choice.</p>
                  {groupFourthOptions.length === 0 && <p className="text-xs text-destructive">No fourth-subject options are configured for this group.</p>}
                  {errors.group_fourth_option_id && <p className="text-xs text-destructive">{errors.group_fourth_option_id.message}</p>}
                </div>
              )}
              <div className="space-y-2">
                <Label>Roll Number</Label>
                <Input type="number" {...register('roll_number', { valueAsNumber: true })} />
              </div>
              <div className="space-y-2">
                <Label>Biometric ID</Label>
                <Input {...register('biometric_id')} placeholder="ZKTeco device ID" />
              </div>
              <div className="space-y-2">
                <Label>Guardian Phone</Label>
                <Input
                  type="tel"
                  inputMode="tel"
                  placeholder="01XXXXXXXXX"
                  {...register('guardian_phone')}
                  aria-invalid={!!errors.guardian_phone}
                />
                {guardianPhone && (
                  <p className={`flex items-center gap-1.5 text-xs ${errors.guardian_phone ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`} aria-live="polite">
                    {errors.guardian_phone ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                    {errors.guardian_phone?.message ?? 'Valid Bangladesh mobile number'}
                  </p>
                )}
              </div>
            </div>
            {isFullAdmin && (
              <div className="space-y-4 border-t py-4">
                <div>
                  <h3 className="text-sm font-semibold">Personal profile</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Optional family details and identity documents.</p>
                </div>
                {editing && (
                  <>
                    <ProfileUploads
                      student={editing}
                      userId={editing.profile_id ?? editing.id}
                      refreshProfile={() => refreshEditingStudent(editing.id)}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Father's Name <span className="font-normal text-muted-foreground">(optional)</span></Label>
                        <Input {...register('father_name')} aria-invalid={!!errors.father_name} />
                        {errors.father_name && <p className="text-xs text-destructive">{errors.father_name.message}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>Mother's Name <span className="font-normal text-muted-foreground">(optional)</span></Label>
                        <Input {...register('mother_name')} aria-invalid={!!errors.mother_name} />
                        {errors.mother_name && <p className="text-xs text-destructive">{errors.mother_name.message}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>Blood Group <span className="font-normal text-muted-foreground">(optional)</span></Label>
                        <Select
                          value={bloodGroup || 'not-specified'}
                          onValueChange={value => setValue('blood_group', value === 'not-specified' ? '' : value as BloodGroup, { shouldValidate: true })}
                        >
                          <SelectTrigger aria-invalid={!!errors.blood_group}><SelectValue placeholder="Select blood group" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="not-specified">Not specified</SelectItem>
                            {BLOOD_GROUPS.map(group => <SelectItem key={group} value={group}>{group}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {errors.blood_group && <p className="text-xs text-destructive">{errors.blood_group.message}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>Secondary Mobile Number <span className="font-normal text-muted-foreground">(optional)</span></Label>
                        <Input type="tel" inputMode="tel" placeholder="01XXXXXXXXX" {...register('secondary_phone')} aria-invalid={!!errors.secondary_phone} />
                        {secondaryPhone && (
                          <p className={`flex items-center gap-1.5 text-xs ${errors.secondary_phone ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`} aria-live="polite">
                            {errors.secondary_phone ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                            {errors.secondary_phone?.message ?? 'Valid Bangladesh mobile number'}
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Update'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Student</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the student record. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { deleteId && deleteStudent.mutate(deleteId); setDeleteId(null) }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Student Account Dialog */}
      <Dialog open={!!accountStudent} onOpenChange={() => setAccountStudent(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set Up Student Login</DialogTitle>
            <DialogDescription>
              Create, view, and share login access for {accountStudent?.first_name} {accountStudent?.last_name}.
            </DialogDescription>
          </DialogHeader>
          <StudentAccountForm
            student={accountStudent}
            session={session}
            creating={creatingAccount}
            setCreating={setCreatingAccount}
            onClose={() => setAccountStudent(null)}
          />
        </DialogContent>
      </Dialog>

    </div>
  )
}

function SyncSummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  )
}


function StudentAccountForm({ student, session, creating, setCreating, onClose }: {
  student: StudentWithClass | null
  session: { access_token: string } | null
  creating: boolean
  setCreating: (v: boolean) => void
  onClose: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [accountExists, setAccountExists] = useState(false)
  const [passwordReady, setPasswordReady] = useState(false)
  const [loadingAccount, setLoadingAccount] = useState(false)
  const queryClient = useQueryClient()

  const makeEmail = (currentStudent: StudentWithClass) => {
    const domain = (import.meta.env.VITE_STUDENT_LOGIN_DOMAIN || 'nmdc.edu').trim()
    const localPart = currentStudent.admission_number.toLowerCase().replace(/[^a-z0-9._-]/g, '')
    return `${localPart || currentStudent.id.slice(0, 8)}@${domain}`
  }

  const makePassword = () => {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    const lower = 'abcdefghijkmnopqrstuvwxyz'
    const numbers = '23456789'
    const symbols = '!@#$%'
    const all = upper + lower + numbers + symbols
    const random = (characters: string) => characters[crypto.getRandomValues(new Uint32Array(1))[0] % characters.length]
    const chars = [random(upper), random(lower), random(numbers), random(symbols)]
    while (chars.length < 12) chars.push(random(all))
    for (let index = chars.length - 1; index > 0; index -= 1) {
      const swapIndex = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1)
      ;[chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]]
    }
    return chars.join('')
  }

  const callAccountApi = async (body: Record<string, unknown>) => {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Student login request failed')
    return result as { email?: string }
  }

  useEffect(() => {
    if (!student) return

    setShowPassword(false)
    setPasswordReady(false)
    setAccountExists(Boolean(student.profile_id))

    if (!student.profile_id) {
      setEmail(makeEmail(student))
      setPassword(makePassword())
      return
    }

    setEmail('')
    setPassword('')
    setLoadingAccount(true)
    callAccountApi({ action: 'get-student-login', student_id: student.id })
      .then(result => setEmail(result.email ?? ''))
      .catch(error => toast.error((error as Error).message))
      .finally(() => setLoadingAccount(false))
    // The selected student is the reset boundary for this form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id])

  if (!student) return null

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`)
    }
  }

  const credentialMessage = passwordReady || !accountExists
    ? `Student login\nName: ${student.first_name} ${student.last_name}\nEmail: ${email}\nPassword: ${password}\n\nPlease change the password after signing in.`
    : `Student login\nName: ${student.first_name} ${student.last_name}\nEmail: ${email}`

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || accountExists) return
    setCreating(true)
    try {
      const { error: linkError } = await db.rpc('link_student_account_by_email', {
        p_student_id: student.id,
        p_email: email.trim(),
      })

      if (!linkError) {
        await queryClient.invalidateQueries({ queryKey: [STUDENTS_KEY] })
        setAccountExists(true)
        setPassword('')
        setPasswordReady(false)
        toast.success('Existing student login linked successfully')
        return
      }

      if (!linkError.message.includes('No existing student login was found')) {
        throw linkError
      }

      if (!password) {
        throw new Error('No existing login was found. Enter a password to create a new account.')
      }

      await callAccountApi({
        email,
        password,
        full_name: `${student.first_name} ${student.last_name}`,
        role: 'student',
        extra: { student_id: student.id },
      })

      await queryClient.invalidateQueries({ queryKey: [STUDENTS_KEY] })
      setAccountExists(true)
      setPasswordReady(true)
      toast.success('Student account created successfully')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const resetPassword = async () => {
    const nextPassword = makePassword()
    setCreating(true)
    try {
      await callAccountApi({
        action: 'reset-student-password',
        student_id: student.id,
        password: nextPassword,
      })
      setPassword(nextPassword)
      setPasswordReady(true)
      setShowPassword(true)
      toast.success('A new temporary password is ready to share')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 py-4">
        {accountExists && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Login account active</p>
              <p className="text-xs opacity-80">
                {passwordReady ? 'Copy the credentials below before closing.' : 'The login email is retained. Generate a new temporary password whenever it needs to be shared again.'}
              </p>
            </div>
          </div>
        )}
        <div className="space-y-2">
          <Label>Email *</Label>
          <div className="flex gap-2">
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={loadingAccount ? 'Loading login...' : 'Student login email'}
              readOnly={accountExists}
              disabled={loadingAccount}
              required
            />
            <Button type="button" variant="outline" size="icon" onClick={() => copyText(email, 'Email')} disabled={!email} title="Copy email">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          {!accountExists && <p className="text-xs text-muted-foreground">Generated from the admission number. You can edit it before creating the account.</p>}
        </div>
        {(!accountExists || passwordReady) && <div className="space-y-2">
          <Label>{accountExists ? 'New temporary password' : 'Temporary password'}</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="pr-10 font-mono"
                minLength={8}
                required={!accountExists}
              />
              <Button type="button" variant="ghost" size="icon-sm" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setShowPassword(value => !value)} title={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {!accountExists && <Button type="button" variant="outline" size="icon" onClick={() => setPassword(makePassword())} title="Generate another password">
              <RefreshCw className="h-4 w-4" />
            </Button>}
            <Button type="button" variant="outline" size="icon" onClick={() => copyText(password, 'Password')} title="Copy password">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>}
        {accountExists && !passwordReady && (
          <Button type="button" variant="outline" className="w-full" onClick={resetPassword} disabled={creating || loadingAccount}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {creating ? 'Generating...' : 'Generate new temporary password'}
          </Button>
        )}
        {(passwordReady || !accountExists) && (
          <Button type="button" variant="secondary" className="w-full" onClick={() => copyText(credentialMessage, 'Login message')} disabled={!email || !password}>
            <Copy className="mr-2 h-4 w-4" />
            Copy login message
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          For security, passwords are not stored or displayed again. The login email stays available here, and an admin can issue a fresh temporary password at any time.
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{accountExists ? 'Done' : 'Cancel'}</Button>
        {!accountExists && <Button type="submit" disabled={creating || !email || password.length < 8}>
          {creating ? 'Creating...' : 'Create Student Login'}
        </Button>}
      </DialogFooter>
    </form>
  )
}
