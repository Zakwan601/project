import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useClasses } from '@/hooks/useClasses'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

// RPC types are maintained manually in this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export function TeacherClassAssignments({ profileId, active }: { profileId: string; active: boolean }) {
  const queryClient = useQueryClient()
  const classesQuery = useClasses()
  const assignmentsQuery = useQuery({
    queryKey: ['teacher-class-assignments', profileId],
    queryFn: async () => {
      const { data, error } = await db.from('teacher_class_assignments').select('class_id').eq('profile_id', profileId)
      if (error) throw error
      return (data as { class_id: string }[]).map(row => row.class_id)
    },
  })
  const [draft, setDraft] = useState<string[] | null>(null)
  const saved = assignmentsQuery.data ?? []
  const selected = draft ?? saved
  const changed = selected.length !== saved.length || selected.some(id => !saved.includes(id))
  const save = useMutation({
    mutationFn: async (classIds: string[]) => {
      const { error } = await db.rpc('set_teacher_classes', { p_profile_id: profileId, p_class_ids: classIds })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['teacher-class-assignments', profileId] })
      setDraft(null)
      toast.success('Teacher classes saved')
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const failed = classesQuery.isError || assignmentsQuery.isError
  const pending = classesQuery.isPending || assignmentsQuery.isPending

  return <section className="mt-5 border-t pt-4" aria-labelledby="teacher-classes-title">
    <h4 id="teacher-classes-title" className="text-sm font-semibold">Assigned classes</h4>
    <p className="mt-1 text-xs text-muted-foreground">This teacher can access only these classes and their students, within the permissions below. No classes selected means no class access.</p>
    {pending ? <Skeleton className="mt-3 h-20 w-full" /> : failed ? <div className="mt-3 space-y-2"><p className="text-xs text-destructive">Could not load teacher classes.</p><Button size="sm" variant="outline" onClick={() => { void classesQuery.refetch(); void assignmentsQuery.refetch() }}>Retry</Button></div> : <>
      <div className="mt-3 grid max-h-56 gap-x-5 overflow-y-auto sm:grid-cols-2">
        {classesQuery.data?.map(cls => <label key={cls.id} className="flex cursor-pointer items-center gap-2.5 border-b py-2.5 text-sm">
          <Checkbox checked={selected.includes(cls.id)} disabled={save.isPending || !active} onCheckedChange={checked => setDraft(current => {
            const ids = current ?? saved
            return checked === true ? [...ids, cls.id] : ids.filter(id => id !== cls.id)
          })} />
          <span className="min-w-0"><span className="block font-medium">{cls.name}{!cls.is_active && <span className="font-normal text-muted-foreground"> (inactive)</span>}</span><span className="block text-xs text-muted-foreground">{cls.academic_years?.name || 'No academic session'}</span></span>
        </label>)}
        {!classesQuery.data?.length && <p className="py-3 text-xs text-muted-foreground">No classes available.</p>}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{selected.length} {selected.length === 1 ? 'class' : 'classes'} selected{!active ? '. Activate this account to change assignments.' : ''}</p>
        <Button size="sm" variant="outline" disabled={!changed || save.isPending || !active} onClick={() => save.mutate(selected)}>{save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save classes</Button>
      </div>
    </>}
  </section>
}
