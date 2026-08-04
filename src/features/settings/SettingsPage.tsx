import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save, School } from 'lucide-react'
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

const yearSchema = z.object({
  name: z.string().min(1, 'Required'),
  start_date: z.string().min(1, 'Required'),
  end_date: z.string().min(1, 'Required'),
})
type YearForm = z.infer<typeof yearSchema>

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

export function SettingsPage() {
  const { data: years, isLoading } = useAcademicYears()
  const qc = useQueryClient()

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<YearForm>({
    resolver: zodResolver(yearSchema),
  })

  const createYear = useMutation({
    mutationFn: async (data: YearForm) => {
      await db.from('academic_years').update({ is_current: false }).gte('id', '')
      const { data: year, error } = await db
        .from('academic_years')
        .insert({ name: data.name, start_date: data.start_date, end_date: data.end_date, is_current: true })
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

  const setCurrent = useMutation({
    mutationFn: async (id: string) => {
      await db.from('academic_years').update({ is_current: false }).neq('id', id)
      const { error } = await db
        .from('academic_years')
        .update({ is_current: true })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['academic_years'] })
      toast.success('Current year updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) return <LoadingState />

  return (
    <div className="max-w-3xl space-y-3 sm:space-y-6">
      <PageHeader title="Settings" description="Manage system configuration and academic years" />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <School className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>Academic Years</CardTitle>
              <CardDescription>Manage your school's academic years</CardDescription>
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
                  {years.map((year: AcademicYear) => (
                    <TableRow key={year.id}>
                      <TableCell className="font-medium">{year.name}</TableCell>
                      <TableCell>{formatDisplayDate(year.start_date)}</TableCell>
                      <TableCell>{formatDisplayDate(year.end_date)}</TableCell>
                      <TableCell>
                        <Badge variant={year.is_current ? 'default' : 'secondary'}>
                          {year.is_current ? 'Current' : 'Past'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {!year.is_current && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7"
                            onClick={() => setCurrent.mutate(year.id)}
                            disabled={setCurrent.isPending}
                          >
                            Set Current
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Separator className="my-3 sm:my-6" />
            </>
          )}

          <form onSubmit={handleSubmit(d => createYear.mutate(d))} className="space-y-3 sm:space-y-4">
            <h4 className="text-sm font-medium">Add New Academic Year</h4>
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input {...register('name')} placeholder="2025-2026" aria-invalid={!!errors.name} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" {...register('start_date')} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" {...register('end_date')} />
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
            <span className="font-medium">Axentra@Zuanshi v1.0</span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-muted-foreground">Database</span>
            <span className="font-medium">Supabase PostgreSQL</span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-muted-foreground">Biometric Support</span>
            <span className="font-medium">ZKTeco MB10-VL (Ready)</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Version</span>
            <Badge variant="outline">1.0.0</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
