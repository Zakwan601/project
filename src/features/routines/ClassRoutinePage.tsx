import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { classRoutinesService, type RoutineEntry } from '@/services/classRoutines'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ErrorState, LoadingState } from '@/components/shared/PageHeader'

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const week = [0, 1, 2, 3, 4, 5, 6]
function timeLabel(time: string) {
  const [hour, minute] = time.split(':').map(Number)
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}

export function ClassRoutinePage({ publicView = false }: { publicView?: boolean }) {
  const { role, session, student } = useAuth()
  const [selected, setSelected] = useState('')
  const [editor, setEditor] = useState<RoutineEntry | 'new' | null>(null)
  const [deleting, setDeleting] = useState<RoutineEntry | null>(null)
  const qc = useQueryClient()
  const admin = role === 'admin'
  const query = useQuery({ queryKey: ['class-routines', selected], queryFn: ({ signal }) => classRoutinesService.get(selected, signal) })
  const classes = query.data?.classes
  useEffect(() => {
    if (!selected && classes?.length) setSelected(classes.find(row => row.id === student?.class_id)?.id ?? classes[0].id)
  }, [classes, selected, student?.class_id])
  const remove = useMutation({ mutationFn: (id: string) => classRoutinesService.remove(id), onSuccess: () => {
    setDeleting(null); void qc.invalidateQueries({ queryKey: ['class-routines'] }); toast.success('Routine entry removed.')
  }, onError: (error: Error) => toast.error(error.message) })
  const content = <div className="min-w-0 space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">Class routine</h1><p className="mt-1 text-sm text-muted-foreground">Weekly class timetable · All times are Bangladesh time.</p></div>
      {publicView && <Button variant="ghost" asChild><Link to={session ? '/dashboard' : '/login'}>{session ? 'Dashboard' : 'Sign in'}</Link></Button>}
    </header>
    <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4"><div className="w-full space-y-1.5 sm:w-80"><Label htmlFor="routine-class">Class</Label>
      <Select value={selected} onValueChange={setSelected}><SelectTrigger id="routine-class" className="w-full"><SelectValue placeholder="Choose a class" /></SelectTrigger><SelectContent>
        {classes?.map(row => <SelectItem key={row.id} value={row.id}>{row.name}{row.session ? ` · ${row.session}` : ''}</SelectItem>)}
      </SelectContent></Select></div>
      {admin && <Button size="sm" disabled={!selected || query.isPending} onClick={() => setEditor('new')}><Plus className="mr-1 h-4 w-4" />Add period</Button>}
    </div>
    {query.isPending ? <LoadingState message="Loading class routine..." /> : query.isError ? <div><ErrorState message="Could not load class routines." /><Button variant="ghost" onClick={() => void query.refetch()}>Retry</Button></div>
      : !classes?.length ? <p className="py-8 text-sm text-muted-foreground">No active classes available.</p>
      : !query.data.entries.length ? <p className="py-8 text-sm text-muted-foreground">No routine has been added for this class yet.</p>
      : <div className="divide-y">{week.filter(day => query.data.entries.some(row => row.day_of_week === day)).map(day => <section key={day} className="grid gap-2 py-4 sm:grid-cols-[8rem_1fr]">
        <h2 className="text-sm font-semibold">{days[day]}</h2><div className="divide-y">{query.data.entries.filter(row => row.day_of_week === day).map(row => <div key={row.id} className="flex items-center gap-3 py-2 first:pt-0">
          <div className="min-w-0 flex-1 sm:grid sm:grid-cols-[11rem_1fr] sm:gap-3"><p className="text-xs tabular-nums text-muted-foreground">{timeLabel(row.start_time)} – {timeLabel(row.end_time)}</p>
            <div><p className="text-sm font-medium">{row.subject_name}</p>{(row.teacher_name || row.room) && <p className="mt-0.5 text-xs text-muted-foreground">{[row.teacher_name, row.room && `Room ${row.room}`].filter(Boolean).join(' · ')}</p>}</div></div>
          {admin && <div className="flex shrink-0"><Button size="icon" variant="ghost" aria-label={`Edit ${row.subject_name} on ${days[day]}`} onClick={() => setEditor(row)}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="text-destructive" aria-label={`Delete ${row.subject_name} on ${days[day]}`} onClick={() => setDeleting(row)}><Trash2 className="h-4 w-4" /></Button></div>}
        </div>)}</div></section>)}</div>}
    {admin && <>
      <Dialog open={editor !== null} onOpenChange={open => { if (!open) setEditor(null) }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{editor === 'new' ? 'Add period' : 'Edit period'}</DialogTitle><DialogDescription>Saved periods are visible to everyone, including visitors who are not signed in.</DialogDescription></DialogHeader>
        {editor && <RoutineForm key={editor === 'new' ? 'new' : editor.id} classId={selected} entry={editor === 'new' ? undefined : editor} onSaved={() => setEditor(null)} />}
      </DialogContent></Dialog>
      <Dialog open={Boolean(deleting)} onOpenChange={open => { if (!open && !remove.isPending) setDeleting(null) }}><DialogContent><DialogHeader><DialogTitle>Remove this period?</DialogTitle><DialogDescription>{deleting?.subject_name} will be removed from the published class routine.</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="ghost" disabled={remove.isPending} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>{remove.isPending ? 'Removing...' : 'Remove period'}</Button></div></DialogContent></Dialog>
    </>}
  </div>
  return publicView ? <main className="mx-auto min-h-screen max-w-5xl p-4 sm:p-8">{content}</main> : content
}

function RoutineForm({ classId, entry, onSaved }: { classId: string; entry?: RoutineEntry; onSaved: () => void }) {
  const [day, setDay] = useState(String(entry?.day_of_week ?? 0))
  const [start, setStart] = useState(entry?.start_time.slice(0, 5) ?? '08:30')
  const [end, setEnd] = useState(entry?.end_time.slice(0, 5) ?? '09:15')
  const [subject, setSubject] = useState(entry?.subject_name ?? '')
  const [teacher, setTeacher] = useState(entry?.teacher_name ?? '')
  const [room, setRoom] = useState(entry?.room ?? '')
  const qc = useQueryClient()
  const save = useMutation({ mutationFn: () => classRoutinesService.save({ class_id: entry?.class_id ?? classId, day_of_week: Number(day), start_time: start, end_time: end, subject_name: subject.trim(), teacher_name: teacher.trim(), room: room.trim() }, entry?.id), onSuccess: () => {
    void qc.invalidateQueries({ queryKey: ['class-routines'] }); toast.success('Class routine saved.'); onSaved()
  }, onError: (error: Error) => toast.error(error.message) })
  const valid = subject.trim().length > 0 && start && end && start < end
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (valid && !save.isPending) save.mutate() }}>
    <div className="space-y-1.5"><Label htmlFor="routine-day">Day</Label><Select value={day} onValueChange={setDay}><SelectTrigger id="routine-day" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{days.map((name, index) => <SelectItem key={name} value={String(index)}>{name}</SelectItem>)}</SelectContent></Select></div>
    <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label htmlFor="routine-start">Start time</Label><Input id="routine-start" type="time" required value={start} onChange={event => setStart(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="routine-end">End time</Label><Input id="routine-end" type="time" required value={end} onChange={event => setEnd(event.target.value)} /></div></div>
    {start && end && start >= end && <p role="alert" className="text-xs text-destructive">End time must be after start time.</p>}
    <div className="space-y-1.5"><Label htmlFor="routine-subject">Subject</Label><Input id="routine-subject" required maxLength={160} value={subject} onChange={event => setSubject(event.target.value)} placeholder="Subject or elective subjects" /></div>
    <div className="space-y-1.5"><Label htmlFor="routine-teacher">Teacher (optional, public)</Label><Input id="routine-teacher" maxLength={120} value={teacher} onChange={event => setTeacher(event.target.value)} /></div>
    <div className="space-y-1.5"><Label htmlFor="routine-room">Room (optional)</Label><Input id="routine-room" maxLength={80} value={room} onChange={event => setRoom(event.target.value)} /></div>
    <div className="flex justify-end"><Button type="submit" disabled={!valid || save.isPending}>{save.isPending ? 'Saving...' : 'Save period'}</Button></div>
  </form>
}
