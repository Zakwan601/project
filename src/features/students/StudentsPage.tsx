import { useState } from 'react'
import { motion } from 'framer-motion'
import { Clock3, KeyRound, Pencil, Search, Trash2, UserCircle } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useStudents, useUpdateStudent, useDeleteStudent } from '@/hooks/useStudents'
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
import { formatDatabaseWallClock } from '@/lib/dateTime'

const studentSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  admission_number: z.string().min(1, 'Required'),
  class_id: z.string().optional(),
  roll_number: z.number().optional(),
  gender: z.string().optional(),
  date_of_birth: z.string().optional(),
  guardian_name: z.string().optional(),
  guardian_phone: z.string().optional(),
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
  const { session, role } = useAuth()

  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editing, setEditing] = useState<StudentWithClass | null>(null)
  const [accountStudent, setAccountStudent] = useState<StudentWithClass | null>(null)
  const [punchStudent, setPunchStudent] = useState<StudentWithClass | null>(null)
  const [creatingAccount, setCreatingAccount] = useState(false)

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<StudentForm>({
    resolver: zodResolver(studentSchema),
  })

  const classId = watch('class_id')

  const filtered = students?.filter(s =>
    `${s.first_name} ${s.last_name} ${s.admission_number}`.toLowerCase().includes(search.toLowerCase())
  ) ?? []

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
      guardian_phone: data.guardian_phone || null,
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
                          title="Create login account"
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
                <Input type="date" {...register('date_of_birth')} />
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
                <Input {...register('guardian_phone')} />
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
            <DialogTitle>Create Login Account</DialogTitle>
            <DialogDescription>
              Create a login account for {accountStudent?.first_name} {accountStudent?.last_name}. The student will be able to log in with these credentials.
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
    </div>
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

  if (!student) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setCreating(true)
    try {
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
          <Label>Password *</Label>
          <Input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Min 6 characters"
            minLength={6}
            required
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={creating}>
          {creating ? 'Creating...' : 'Create Account'}
        </Button>
      </DialogFooter>
    </form>
  )
}
