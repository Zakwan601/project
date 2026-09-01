import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { Check, Clock3, Copy, Eye, EyeOff, GraduationCap, History, KeyRound, Pencil, RefreshCw, Search, ShieldCheck, Trash2, UserCircle, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { STUDENTS_KEY, useStudents, useUpdateStudent, useDeleteStudent, usePromoteStudents, useStudentEnrollmentHistory } from '@/hooks/useStudents'
import { useStudentPunches } from '@/hooks/useDeviceLogs'
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
import type { Student, StudentWithClass } from '@/types/database'
import { formatBangladeshDateTime, formatDisplayDate } from '@/lib/dateTime'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { isValidBangladeshMobile } from '@/lib/profile'
import { Checkbox } from '@/components/ui/checkbox'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { syncZktecoUsers, type ZktecoSyncSummary } from '@/services/zktecoUsers'
import { ADMIN_DASHBOARD_KEY } from '@/hooks/useDashboard'

// Database types are maintained manually in this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

const studentSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  admission_number: z.string().min(1, 'Required'),
  class_id: z.string().optional(),
  roll_number: z.number().optional(),
  guardian_phone: z.string().optional().refine(
    value => !value?.trim() || isValidBangladeshMobile(value),
    'Enter a valid Bangladesh mobile number',
  ),
  biometric_id: z.string().optional(),
})
type StudentForm = z.infer<typeof studentSchema>

export function StudentsPage() {
  const { data: students, isLoading, error } = useStudents()
  const { data: classes } = useClasses()
  const updateStudent = useUpdateStudent()
  const deleteStudent = useDeleteStudent()
  const promoteStudents = usePromoteStudents()
  const queryClient = useQueryClient()
  const { session, role, can } = useAuth()
  const canWriteStudents = can('students', 'write')
  const isFullAdmin = role === 'admin'

  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editing, setEditing] = useState<StudentWithClass | null>(null)
  const [accountStudent, setAccountStudent] = useState<StudentWithClass | null>(null)
  const [punchStudent, setPunchStudent] = useState<StudentWithClass | null>(null)
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])
  const [promotionOpen, setPromotionOpen] = useState(false)
  const [targetClassId, setTargetClassId] = useState('')
  const [promotionDate, setPromotionDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [historyStudent, setHistoryStudent] = useState<StudentWithClass | null>(null)
  const [isSyncingUsers, setIsSyncingUsers] = useState(false)
  const [syncSummary, setSyncSummary] = useState<ZktecoSyncSummary | null>(null)

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<StudentForm>({
    resolver: zodResolver(studentSchema),
    mode: 'onChange',
  })

  const classId = watch('class_id')
  const guardianPhone = watch('guardian_phone')

  const filtered = students?.filter(student => {
    const matchesSearch = `${student.first_name} ${student.last_name} ${student.admission_number}`
      .toLowerCase()
      .includes(search.toLowerCase())
    const matchesClass = classFilter === 'all'
      || (classFilter === 'unassigned' ? !student.class_id : student.class_id === classFilter)

    return matchesSearch && matchesClass
  }) ?? []
  const allFilteredSelected = filtered.length > 0 && filtered.every(student => selectedStudentIds.includes(student.id))

  const toggleStudent = (studentId: string, checked: boolean) => {
    setSelectedStudentIds(current => checked
      ? [...new Set([...current, studentId])]
      : current.filter(id => id !== studentId))
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

  const openEdit = (s: StudentWithClass) => {
    setEditing(s)
    reset({
      first_name: s.first_name,
      last_name: s.last_name,
      admission_number: s.admission_number,
      class_id: s.class_id ?? undefined,
      roll_number: s.roll_number ?? undefined,
      guardian_phone: s.guardian_phone ?? undefined,
      biometric_id: s.biometric_id ?? undefined,
    })
    setDialogOpen(true)
  }

  const onSubmit = async (data: StudentForm) => {
    const payload: Partial<Student> = {
      first_name: data.first_name,
      last_name: data.last_name,
      admission_number: data.admission_number,
      class_id: data.class_id || null,
      roll_number: data.roll_number ?? null,
      guardian_phone: data.guardian_phone?.trim() || null,
      biometric_id: data.biometric_id || null,
    }

    if (!editing) return
    await updateStudent.mutateAsync({ id: editing.id, updates: payload })
    setDialogOpen(false)
    reset({})
  }

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState message={(error as Error).message} />

  return (
    <div>
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

      <Card>
        <div className="border-b p-3 sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search students..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Filter students by class">
                <SelectValue placeholder="All classes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All classes</SelectItem>
                <SelectItem value="unassigned">No class assigned</SelectItem>
                {classes?.map(currentClass => (
                  <SelectItem key={currentClass.id} value={currentClass.id}>
                    {currentClass.name} ({currentClass.grade}-{currentClass.section})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="No students found"
            description={search || classFilter !== 'all'
              ? 'Try changing the search or class filter.'
              : 'Students will appear here when synchronized.'}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {canWriteStudents && <TableHead className="w-10">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={checked => setSelectedStudentIds(
                      checked ? filtered.map(student => student.id) : [],
                    )}
                    aria-label="Select all visible students"
                  />
                </TableHead>}
                <TableHead>Name</TableHead>
                <TableHead>Admission No.</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Roll No.</TableHead>
                <TableHead>Guardian Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((student, i) => (
                <motion.tr
                  key={student.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className="border-b transition-colors hover:bg-muted/50"
                >
                  {canWriteStudents && <TableCell>
                    <Checkbox
                      checked={selectedStudentIds.includes(student.id)}
                      onCheckedChange={checked => toggleStudent(student.id, checked === true)}
                      aria-label={`Select ${student.first_name} ${student.last_name}`}
                    />
                  </TableCell>}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <UserCircle className="h-8 w-8 text-muted-foreground shrink-0" />
                      <div>
                        <p className="font-medium">{student.first_name} {student.last_name}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{student.admission_number}</TableCell>
                  <TableCell>
                    {student.classes
                      ? <span className="text-sm">{student.classes.name} ({student.classes.grade}-{student.classes.section})</span>
                      : <span className="text-muted-foreground text-sm">—</span>}
                  </TableCell>
                  <TableCell>{student.roll_number ?? '—'}</TableCell>
                  <TableCell>
                    <p className="text-xs text-muted-foreground">{student.guardian_phone ?? ''}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={student.is_active ? 'default' : 'secondary'}>
                      {student.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setHistoryStudent(student)}
                        title="Academic history"
                      >
                        <History className="h-3.5 w-3.5" />
                      </Button>
                      {can('punches') && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setPunchStudent(student)}
                          title="View punching data"
                          className="text-emerald-600 hover:text-emerald-700"
                        >
                          <Clock3 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {isFullAdmin && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setAccountStudent(student)}
                          title={student.profile_id ? 'View or reset login credentials' : 'Set up login account'}
                          className="text-blue-600 hover:text-blue-700"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canWriteStudents && <Button variant="ghost" size="icon-sm" onClick={() => openEdit(student)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>}
                      {canWriteStudents && <Button variant="ghost" size="icon-sm" onClick={() => setDeleteId(student.id)}
                        className="text-destructive hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>}
                    </div>
                  </TableCell>
                </motion.tr>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

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
                <Select value={classId} onValueChange={v => setValue('class_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                  <SelectContent>
                    {classes?.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name} ({c.grade}-{c.section})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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

      <PunchHistoryDialog
        student={punchStudent}
        onClose={() => setPunchStudent(null)}
      />
      <EnrollmentHistoryDialog student={historyStudent} onClose={() => setHistoryStudent(null)} />
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

function EnrollmentHistoryDialog({ student, onClose }: {
  student: StudentWithClass | null
  onClose: () => void
}) {
  const { data: history = [], isLoading, error } = useStudentEnrollmentHistory(student?.id)

  return (
    <Dialog open={student !== null} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Academic history</DialogTitle>
          <DialogDescription>{student?.first_name} {student?.last_name}</DialogDescription>
        </DialogHeader>
        {isLoading ? <LoadingState message="Loading academic history..." /> : error ? (
          <ErrorState message={(error as Error).message} />
        ) : history.length === 0 ? (
          <EmptyState title="No academic history" description="The current assignment will appear after the enrollment migration is applied." />
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {history.map(enrollment => (
              <div key={enrollment.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">
                    {enrollment.classes.name} ({enrollment.classes.grade}-{enrollment.classes.section})
                  </p>
                  <p className="text-xs text-muted-foreground">{enrollment.academic_years.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDisplayDate(enrollment.started_on)} – {enrollment.ended_on ? formatDisplayDate(enrollment.ended_on) : 'Current'}
                  </p>
                </div>
                <Badge variant={enrollment.ended_on ? 'secondary' : 'default'} className="capitalize">
                  {enrollment.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PunchHistoryDialog({
  student,
  onClose,
}: {
  student: StudentWithClass | null
  onClose: () => void
}) {
  const {
    data: punches = [],
    isLoading,
    error,
  } = useStudentPunches(student?.admission_number ?? null)

  const processedCount = punches.filter(punch => punch.processed).length
  const latestPunch = punches[0]?.punched_at ?? null

  return (
    <Dialog open={student !== null} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Punching Data — {student?.first_name} {student?.last_name}
          </DialogTitle>
          <DialogDescription>
            Biometric Id = {' '}
            <span className="font-mono font-medium text-foreground">
              {student?.admission_number}
            </span>
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <LoadingState message="Loading punching data..." />
        ) : error ? (
          <ErrorState message={(error as Error).message} />
        ) : punches.length === 0 ? (
          <EmptyState
            title="No punching data found"
            description={`No device logs match admission number ${student?.admission_number ?? ''}.`}
          />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <PunchSummary label="Total punches" value={String(punches.length)} />
              <PunchSummary label="Processed" value={`${processedCount} / ${punches.length}`} />
              <PunchSummary label="Latest punch" value={latestPunch ? formatDate(latestPunch) : '—'} />
            </div>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Punched at</TableHead>
                    <TableHead>Biometric ID</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Processed</TableHead>
                    <TableHead>Attendance record</TableHead>
                    <TableHead>Created at</TableHead>
                    <TableHead>Raw data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {punches.map(punch => (
                    <TableRow key={punch.id}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {formatDate(punch.punched_at)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {punch.student_biometric_id}
                      </TableCell>
                      <TableCell>
                        <p className="whitespace-nowrap text-sm">
                          {punch.devices?.alias || punch.devices?.name || 'Unknown device'}
                        </p>
                        <p className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {punch.devices?.sn || punch.devices?.device_serial || '—'}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={punch.processed ? 'default' : 'secondary'}>
                          {punch.processed ? 'Processed' : 'Pending'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {punch.attendance_record_id ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(punch.created_at)}
                      </TableCell>
                      <TableCell>
                        {punch.raw_data ? (
                          <details>
                            <summary className="cursor-pointer text-xs text-primary">View</summary>
                            <pre className="mt-2 max-h-48 min-w-72 overflow-auto rounded bg-muted p-2 text-[10px]">
                              {JSON.stringify(punch.raw_data, null, 2)}
                            </pre>
                          </details>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {punches.length === 500 && (
              <p className="text-xs text-muted-foreground">
                Showing the latest 500 punching records for this student.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PunchSummary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  )
}

function formatDate(value: string | null) {
  return formatBangladeshDateTime(value)
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
