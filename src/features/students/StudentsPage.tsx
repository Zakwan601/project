import { useState } from 'react'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { Check, Clock3, GraduationCap, History, KeyRound, Pencil, Search, Trash2, UserCircle, X } from 'lucide-react'
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
import { formatDatabaseWallClock, formatDisplayDate } from '@/lib/dateTime'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { isValidBangladeshMobile } from '@/lib/profile'
import { Checkbox } from '@/components/ui/checkbox'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Database types are maintained manually in this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

const studentSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  admission_number: z.string().min(1, 'Required'),
  class_id: z.string().optional(),
  roll_number: z.number().optional(),
  gender: z.string().optional(),
  date_of_birth: z.string().optional(),
  guardian_name: z.string().optional(),
  guardian_phone: z.string().optional().refine(
    value => !value?.trim() || isValidBangladeshMobile(value),
    'Enter a valid Bangladesh mobile number',
  ),
  guardian_email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  biometric_id: z.string().optional(),
})
type StudentForm = z.infer<typeof studentSchema>

export function StudentsPage() {
  const { data: students, isLoading, error } = useStudents()
  const { data: classes } = useClasses()
  const updateStudent = useUpdateStudent()
  const deleteStudent = useDeleteStudent()
  const promoteStudents = usePromoteStudents()
  const { session, role } = useAuth()

  const [search, setSearch] = useState('')
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

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<StudentForm>({
    resolver: zodResolver(studentSchema),
    mode: 'onChange',
  })

  const classId = watch('class_id')
  const guardianPhone = watch('guardian_phone')

  const filtered = students?.filter(s =>
    `${s.first_name} ${s.last_name} ${s.admission_number}`.toLowerCase().includes(search.toLowerCase())
  ) ?? []
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
    if (targetClass?.academic_years?.start_date) {
      setPromotionDate(targetClass.academic_years.start_date)
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
      gender: s.gender ?? undefined,
      date_of_birth: s.date_of_birth ?? undefined,
      guardian_name: s.guardian_name ?? undefined,
      guardian_phone: s.guardian_phone ?? undefined,
      guardian_email: s.guardian_email ?? undefined,
      address: s.address ?? undefined,
      biometric_id: s.biometric_id ?? undefined,
    })
    setDialogOpen(true)
  }

  const onSubmit = async (data: StudentForm) => {
    const payload: Omit<Student, 'id' | 'created_at' | 'updated_at'> = {
      first_name: data.first_name,
      last_name: data.last_name,
      admission_number: data.admission_number,
      class_id: data.class_id || null,
      roll_number: data.roll_number ?? null,
      gender: data.gender || null,
      date_of_birth: data.date_of_birth || null,
      guardian_name: data.guardian_name || null,
      guardian_phone: data.guardian_phone?.trim() || null,
      guardian_email: data.guardian_email || null,
      address: data.address || null,
      biometric_id: data.biometric_id || null,
      profile_id: null,
      photo_url: null,
      date_of_admission: new Date().toISOString().split('T')[0],
      is_active: true,
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
        action={role === 'admin' && selectedStudentIds.length > 0 ? (
          <Button size="sm" onClick={() => setPromotionOpen(true)}>
            <GraduationCap className="mr-1.5 h-4 w-4" />
            Promote ({selectedStudentIds.length})
          </Button>
        ) : undefined}
      />

      <Card>
        <div className="border-b p-3 sm:p-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search students..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title="No students found" description={search ? 'Try a different search' : 'Students will appear here when synchronized.'} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {role === 'admin' && <TableHead className="w-10">
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
                <TableHead>Guardian</TableHead>
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
                  {role === 'admin' && <TableCell>
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
                        <p className="text-xs text-muted-foreground">{student.gender ?? '—'}</p>
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
                    <p className="text-sm">{student.guardian_name ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">{student.guardian_phone ?? ''}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={student.is_active ? 'default' : 'secondary'}>
                      {student.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {role === 'admin' && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setHistoryStudent(student)}
                          title="Academic history"
                        >
                          <History className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {role === 'admin' && (
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
                      {!student.profile_id && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setAccountStudent(student)}
                          title="Set up or link login account"
                          className="text-blue-600 hover:text-blue-700"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(student)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => setDeleteId(student.id)}
                        className="text-destructive hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </motion.tr>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={promotionOpen} onOpenChange={setPromotionOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Promote students</DialogTitle>
            <DialogDescription>
              Move {selectedStudentIds.length} selected student{selectedStudentIds.length === 1 ? '' : 's'} to a class in the next academic year. Their current assignments will be archived automatically.
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
                <Label>Gender</Label>
                <Select value={watch('gender')} onValueChange={v => setValue('gender', v)}>
                  <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Date of Birth</Label>
                <DatePickerInput
                  value={watch('date_of_birth') ?? ''}
                  onChange={value => setValue('date_of_birth', value, { shouldDirty: true })}
                  max={format(new Date(), 'yyyy-MM-dd')}
                />
              </div>
              <div className="space-y-2">
                <Label>Biometric ID</Label>
                <Input {...register('biometric_id')} placeholder="ZKTeco device ID" />
              </div>
              <div className="space-y-2">
                <Label>Guardian Name</Label>
                <Input {...register('guardian_name')} />
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
              <div className="space-y-2 col-span-2">
                <Label>Guardian Email</Label>
                <Input type="email" {...register('guardian_email')} />
                {errors.guardian_email && <p className="text-xs text-destructive">{errors.guardian_email.message}</p>}
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Address</Label>
                <Input {...register('address')} />
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
              Link an existing login by email, or enter a password to create a new account for {accountStudent?.first_name} {accountStudent?.last_name}.
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
  return formatDatabaseWallClock(value)
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
  const queryClient = useQueryClient()

  if (!student) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setCreating(true)
    try {
      const { error: linkError } = await db.rpc('link_student_account_by_email', {
        p_student_id: student.id,
        p_email: email.trim(),
      })

      if (!linkError) {
        await queryClient.invalidateQueries({ queryKey: [STUDENTS_KEY] })
        toast.success('Existing student login linked successfully')
        onClose()
        return
      }

      if (!linkError.message.includes('No existing student login was found')) {
        throw linkError
      }

      if (!password) {
        throw new Error('No existing login was found. Enter a password to create a new account.')
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email,
          password,
          full_name: `${student.first_name} ${student.last_name}`,
          role: 'student',
          extra: { student_id: student.id },
        }),
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Failed to create account')

      await queryClient.invalidateQueries({ queryKey: [STUDENTS_KEY] })
      toast.success('Student account created successfully')
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label>Email *</Label>
          <Input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder={`${student.first_name.toLowerCase()}.${student.last_name.toLowerCase()}@school.edu`}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Password <span className="text-muted-foreground">(new accounts only)</span></Label>
          <Input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Min 6 characters"
            minLength={6}
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={creating}>
          {creating ? 'Checking...' : 'Link or Create Account'}
        </Button>
      </DialogFooter>
    </form>
  )
}
