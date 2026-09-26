import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any
import { toast } from 'sonner'
import { PageHeader, LoadingState } from '@/components/shared/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { formatDisplayDate } from '@/lib/dateTime'
import type { AcademicYear } from '@/types/database'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { format } from 'date-fns'

const yearSchema = z.object({
  name: z.string().min(1, 'Required'),
  start_date: z.string().min(1, 'Required'),
  end_date: z.string().min(1, 'Required'),
})
type YearForm = z.infer<typeof yearSchema>

const attendanceFineSchema = z.object({
  fine_per_absent_day: z.number().min(0, 'Fine cannot be negative').max(1000000, 'Fine is too large'),
})
type AttendanceFineForm = z.infer<typeof attendanceFineSchema>

interface AttendanceFineSetting {
  fine_per_absent_day: number | string
}

function useAcademicYears() {
  return useQuery<AcademicYear[]>({
    queryKey: ['academic_years'],
    queryFn: async () => {
      const { data, error } = await db
        .from('academic_years')
        .select('*')
        .order('start_date', { ascending: false })
      if (error) throw error
      return data as AcademicYear[]
    },
  })
}

function useAttendanceFineSetting() {
  return useQuery<AttendanceFineSetting>({
    queryKey: ['attendance_fine_setting'],
    queryFn: async () => {
      const { data, error } = await db
        .from('attendance_fine_settings')
        .select('fine_per_absent_day')
        .eq('id', true)
        .single()
      if (error) throw error
      return data as AttendanceFineSetting
    },
  })
}

export function SettingsPage() {
  const { data: years, isLoading } = useAcademicYears()
  const { data: attendanceFineSetting, isLoading: attendanceFineLoading } = useAttendanceFineSetting()
  const qc = useQueryClient()
  const today = format(new Date(), 'yyyy-MM-dd')

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<YearForm>({
    resolver: zodResolver(yearSchema),
  })
  const {
    register: registerFine,
    handleSubmit: handleFineSubmit,
    reset: resetFine,
    formState: { errors: fineErrors, isSubmitting: isFineSubmitting },
  } = useForm<AttendanceFineForm>({
    resolver: zodResolver(attendanceFineSchema),
    defaultValues: { fine_per_absent_day: 0 },
  })

  useEffect(() => {
    if (attendanceFineSetting) {
      resetFine({ fine_per_absent_day: Number(attendanceFineSetting.fine_per_absent_day) })
    }
  }, [attendanceFineSetting, resetFine])

  const createYear = useMutation({
    mutationFn: async (data: YearForm) => {
      const { data: year, error } = await db
        .from('academic_years')
        .insert({
          name: data.name,
          start_date: data.start_date,
          end_date: data.end_date,
          is_current: true,
        })
        .select()
        .single()
      if (error) throw error
      return year
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['academic_years'] })
      toast.success('Academic year created')
      reset()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const setSessionActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await db.rpc('set_academic_year_active', {
        p_academic_year_id: id,
        p_is_active: isActive,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['academic_years'] })
      toast.success('Academic session status updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const saveAttendanceFine = useMutation({
    mutationFn: async (data: AttendanceFineForm) => {
      const { error } = await db
        .from('attendance_fine_settings')
        .update({ fine_per_absent_day: data.fine_per_absent_day })
        .eq('id', true)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance_fine_setting'] })
      toast.success('Attendance fine updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading || attendanceFineLoading) return <LoadingState />

  return (
    <div className="max-w-3xl space-y-3 sm:space-y-4">
      <PageHeader title="Settings" description="Manage system configuration and academic years" />

      <Card>
        <CardHeader>
          <CardTitle>Attendance Fine</CardTitle>
          <CardDescription>Set the fine per absence. Too Late counts as absent, every two Late days add one fineable absence, and approved leave is not fined.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleFineSubmit(data => saveAttendanceFine.mutate(data))} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full max-w-xs space-y-2">
              <Label htmlFor="fine-per-absent-day">Fine per absent day (৳)</Label>
              <Input
                id="fine-per-absent-day"
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                inputMode="decimal"
                {...registerFine('fine_per_absent_day', { valueAsNumber: true })}
                aria-invalid={!!fineErrors.fine_per_absent_day}
              />
              {fineErrors.fine_per_absent_day && <p className="text-xs text-destructive">{fineErrors.fine_per_absent_day.message}</p>}
            </div>
            <Button type="submit" size="sm" disabled={isFineSubmitting || saveAttendanceFine.isPending}>
              {(isFineSubmitting || saveAttendanceFine.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-2 h-4 w-4" /> Save Fine
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
             <div>
              <CardTitle>Academic Sessions</CardTitle>
              <CardDescription>Manage overlapping student cohort sessions</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {years && years.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Start Date</TableHead>
                    <TableHead>End Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {years.map((year: AcademicYear) => {
                    const status = year.is_current
                      ? 'Active'
                      : year.start_date > today
                        ? 'Upcoming'
                        : year.end_date < today
                          ? 'Completed'
                          : 'Inactive'
                    return <TableRow key={year.id}>
                      <TableCell className="font-medium">{year.name}</TableCell>
                      <TableCell>{formatDisplayDate(year.start_date)}</TableCell>
                      <TableCell>{formatDisplayDate(year.end_date)}</TableCell>
                      <TableCell>
                        <Badge variant={year.is_current ? 'default' : 'secondary'}>
                          {status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7"
                            onClick={() => setSessionActive.mutate({ id: year.id, isActive: !year.is_current })}
                            disabled={setSessionActive.isPending}
                          >
                            {year.is_current ? 'Deactivate' : 'Activate'}
                          </Button>
                      </TableCell>
                    </TableRow>
                  })}
                </TableBody>
              </Table>
              <Separator className="my-3 sm:my-6" />
            </>
          )}

          <form onSubmit={handleSubmit(d => createYear.mutate(d))} className="space-y-3 sm:space-y-4">
            <h4 className="text-sm font-medium">Add New Academic Session</h4>
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input {...register('name')} placeholder="2025-2026" aria-invalid={!!errors.name} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Start Date</Label>
                <DatePickerInput
                  value={watch('start_date') ?? ''}
                  onChange={value => setValue('start_date', value, { shouldDirty: true, shouldValidate: true })}
                  required
                />
                {errors.start_date && <p className="text-xs text-destructive">{errors.start_date.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <DatePickerInput
                  value={watch('end_date') ?? ''}
                  onChange={value => setValue('end_date', value, { shouldDirty: true, shouldValidate: true })}
                  min={watch('start_date')}
                  required
                />
                {errors.end_date && <p className="text-xs text-destructive">{errors.end_date.message}</p>}
              </div>
            </div>
            <Button type="submit" size="sm" disabled={isSubmitting || createYear.isPending}>
              {(isSubmitting || createYear.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-2 h-4 w-4" /> Create Year
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between py-2 border-b">
            <span className="text-muted-foreground">System</span>
            <span className="font-medium">NMDC - Axentra@Zuanshi v1.3 by Zakwan Masud</span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-muted-foreground">Database</span>
            <span className="font-medium">Supabase PostgreSQL and Render PostgreSQL</span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-muted-foreground">Biometric Support</span>
            <span className="font-medium">ZKTeco MB10-VL (Ready)</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Version</span>
            <Badge variant="outline">1.3</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
