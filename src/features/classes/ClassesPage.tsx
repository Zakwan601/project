import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Plus, Search, Pencil, Trash2, BookOpen, Users } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useClasses, useCreateClass, useUpdateClass, useDeleteClass } from '@/hooks/useClasses'
import { supabase } from '@/lib/supabase'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { AcademicYear, Class, ClassWithDetails } from '@/types/database'
import { useAuth } from '@/contexts/AuthContext'

const classSchema = z.object({
  academic_year_id: z.string().min(1, 'Academic year is required'),
  name: z.string().min(1, 'Required'),
  grade: z.string().min(1, 'Required'),
  section: z.string().min(1, 'Required'),
  capacity: z.number().int().min(1),
  room: z.string().optional(),
})
type ClassForm = z.infer<typeof classSchema>

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

export function ClassesPage() {
  const { can } = useAuth()
  const canWriteClasses = can('classes', 'write')
  const { data: classes, isLoading, error } = useClasses()
  const { data: academicYears } = useAcademicYears()
  const createClass = useCreateClass()
  const updateClass = useUpdateClass()
  const deleteClass = useDeleteClass()

  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editing, setEditing] = useState<ClassWithDetails | null>(null)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<ClassForm, any, ClassForm>({
    resolver: zodResolver(classSchema) as any,
    defaultValues: { section: 'A', capacity: 40 },
  })

  const filtered = classes?.filter(c =>
    `${c.name} ${c.grade} ${c.section}`.toLowerCase().includes(search.toLowerCase())
  ) ?? []

  const openCreate = () => {
    setEditing(null)
    reset({ academic_year_id: defaultAcademicSessionId ?? '', section: 'A', capacity: 40 })
    setDialogOpen(true)
  }

  const openEdit = (c: ClassWithDetails) => {
    setEditing(c)
    reset({
      academic_year_id: c.academic_year_id ?? '',
      name: c.name,
      grade: c.grade,
      section: c.section,
      capacity: c.capacity,
      room: c.room ?? undefined,
    })
    setDialogOpen(true)
  }

  const defaultAcademicSessionId = academicYears?.find((year: AcademicYear) => year.is_current)?.id ?? null

  const onSubmit = async (data: ClassForm) => {
    const payload: Omit<Class, 'id' | 'created_at' | 'updated_at'> = {
      name: data.name,
      grade: data.grade,
      section: data.section,
      capacity: data.capacity,
      room: data.room || null,
      academic_year_id: data.academic_year_id,
      is_active: true,
    }
    if (editing) {
      await updateClass.mutateAsync({ id: editing.id, updates: payload })
    } else {
      await createClass.mutateAsync(payload)
    }
    setDialogOpen(false)
  }

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState message={(error as Error).message} />

  return (
    <div>
      <PageHeader
        title="Classes"
        description={`${classes?.length ?? 0} classes`}
        action={canWriteClasses ? (
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Add Class
          </Button>
        ) : undefined}
      />

      <div className="relative mb-3 max-w-sm sm:mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search classes..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No classes found" description="Add your first class" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {filtered.map((cls, i) => {
            const count = cls.active_student_count ?? 0
            const occupancy = cls.capacity > 0 ? Math.round((count / cls.capacity) * 100) : 0
            return (
              <motion.div key={cls.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="hover:shadow-md transition-shadow">
                  <CardContent className="p-3 sm:p-5">
                    <div className="mb-2 flex items-start justify-between sm:mb-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <BookOpen className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-semibold">{cls.name}</p>
                          <p className="text-xs text-muted-foreground">Grade {cls.grade} · Section {cls.section}</p>
                        </div>
                      </div>
                      {canWriteClasses && <div className="flex gap-1">
                        <Button variant="ghost" size="icon-sm" onClick={() => openEdit(cls)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => setDeleteId(cls.id)} className="text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>}
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5" /> Students
                        </span>
                        <span className="font-medium text-foreground">{count} / {cls.capacity}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${Math.min(occupancy, 100)}%` }}
                        />
                      </div>
                    </div>

                    {cls.room && <p className="text-xs text-muted-foreground">Room: {cls.room}</p>}

                    <div className="flex items-center gap-2 mt-3">
                      <Badge variant={cls.is_active ? 'default' : 'secondary'} className="text-xs">
                        {cls.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {cls.academic_years?.name ?? 'No academic year'}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Class' : 'Add New Class'}</DialogTitle>
            <DialogDescription>Fill in the class details</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="space-y-2 col-span-2">
                <Label>Academic Year *</Label>
                <Select
                  value={watch('academic_year_id')}
                  onValueChange={value => setValue('academic_year_id', value, { shouldValidate: true })}
                  disabled={Boolean(editing)}
                >
                  <SelectTrigger aria-invalid={!!errors.academic_year_id}>
                    <SelectValue placeholder="Select academic year" />
                  </SelectTrigger>
                  <SelectContent>
                    {academicYears?.map(year => (
                      <SelectItem key={year.id} value={year.id}>
                        {year.name}{year.is_current ? ' (Active)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.academic_year_id && <p className="text-xs text-destructive">{errors.academic_year_id.message}</p>}
                {editing && <p className="text-xs text-muted-foreground">Academic year cannot be changed after a class is created.</p>}
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Class Name *</Label>
                <Input {...register('name')} placeholder="e.g. Class 10-A" aria-invalid={!!errors.name} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Grade *</Label>
                <Input {...register('grade')} placeholder="e.g. 10" aria-invalid={!!errors.grade} />
                {errors.grade && <p className="text-xs text-destructive">{errors.grade.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Section</Label>
                <Input {...register('section')} placeholder="A" />
              </div>
              <div className="space-y-2">
                <Label>Capacity</Label>
                <Input type="number" {...register('capacity', { valueAsNumber: true })} />
              </div>
              <div className="space-y-2">
                <Label>Room</Label>
                <Input {...register('room')} placeholder="Room number" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : editing ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Class</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the class and all related data.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { deleteId && deleteClass.mutate(deleteId); setDeleteId(null) }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
