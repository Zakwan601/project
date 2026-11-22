import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { classRoutinesService, type RoutineEntry, type RoutineSettings } from '@/services/classRoutines'
import { RoutineTimetable, routineDays as days } from './RoutineTimetable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ErrorState, LoadingState } from '@/components/shared/PageHeader'

export function ClassRoutinePage({ publicView = false }: { publicView?: boolean }) {
  const { role, session, student, loading } = useAuth()
  const [selected, setSelected] = useState('')
  const [editor, setEditor] = useState<RoutineEntry | 'new' | null>(null)
  const [deleting, setDeleting] = useState<RoutineEntry | null>(null)
  const qc = useQueryClient()
  const admin = role === 'admin'
  const studentView = role === 'student'
  const classId = studentView ? student?.class_id ?? '' : selected
  const query = useQuery({
    queryKey: ['class-routines', classId],
    queryFn: ({ signal }) => classRoutinesService.get(classId, signal),
    enabled: !loading && (!studentView || Boolean(classId)),
  })
  const classes = query.data?.classes
  useEffect(() => {
    if (!studentView && !selected && classes?.length) setSelected(classes.find(row => row.has_routine)?.id ?? classes[0].id)
  }, [classes, selected, studentView])
  const remove = useMutation({ mutationFn: (id: string) => classRoutinesService.remove(id), onSuccess: () => {
    setDeleting(null); void qc.invalidateQueries({ queryKey: ['class-routines'] }); toast.success('Routine entry removed.')
  }, onError: (error: Error) => toast.error(error.message) })
  const timetableClasses = (classes ?? []).filter(row => row.id === classId)
  const timetableEntries = (query.data?.entries ?? []).filter(row => row.class_id === classId)
  const timetableSettings = (query.data?.settings ?? []).filter(row => row.class_id === classId)
  const downloadPath = timetableSettings[0]?.download_path
  const content = <div className="min-w-0 space-y-2 sm:space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-2 sm:gap-3"><div><h1 className="text-lg font-bold sm:text-2xl">Class routine</h1><p className="mt-0.5 text-[10px] text-muted-foreground sm:mt-1 sm:text-sm">Weekly class timetable · All times are Bangladesh time.</p></div>
      {publicView && <Button variant="ghost" asChild><Link to={session ? '/dashboard' : '/login'}>{session ? 'Dashboard' : 'Sign in'}</Link></Button>}
    </header>
    {downloadPath && !loading && <div className="flex justify-end"><Button variant="outline" size="sm" asChild><a href={classRoutinesService.downloadUrl(downloadPath)} download><Download className="mr-1 h-3.5 w-3.5" />Download routine</a></Button></div>}
    {!studentView && <div className="flex items-end justify-between gap-2 border-b pb-2 sm:flex-wrap sm:gap-3 sm:pb-4"><div className="min-w-0 flex-1 space-y-0 sm:w-80 sm:flex-none sm:space-y-1.5"><Label htmlFor="routine-class" className="sr-only sm:not-sr-only">Class</Label>
      <Select value={selected} onValueChange={setSelected}><SelectTrigger id="routine-class" className="h-8 w-full px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"><SelectValue placeholder="Choose a class" /></SelectTrigger><SelectContent>
        {classes?.map(row => <SelectItem key={row.id} value={row.id}>{row.name}{row.session ? ` · ${row.session}` : ''}</SelectItem>)}
      </SelectContent></Select></div>
      {admin && <Button size="sm" className="w-8 shrink-0 px-0 sm:w-auto sm:px-3" aria-label="Add period" disabled={!selected || query.isPending} onClick={() => setEditor('new')}><Plus className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Add period</span></Button>}
    </div>}
    {loading ? <LoadingState message="Loading class routine..." />
      : studentView && !classId ? <p className="py-8 text-sm text-muted-foreground">No class is assigned to your profile yet. Contact the administration to view your routine.</p>
      : query.isPending ? <LoadingState message="Loading class routine..." /> : query.isError ? <div><ErrorState message="Could not load class routines." /><Button variant="ghost" onClick={() => void query.refetch()}>Retry</Button></div>
      : !classes?.length ? <p className="py-8 text-sm text-muted-foreground">No active classes available.</p>
      : !timetableEntries.length ? <p className="py-8 text-sm text-muted-foreground">No routine has been added for this class yet.</p>
      : <RoutineTimetable classes={timetableClasses} entries={timetableEntries} settings={timetableSettings} admin={admin} onEdit={setEditor} onRemove={setDeleting} />}
    {admin && <>
      <Dialog open={editor !== null} onOpenChange={open => { if (!open) setEditor(null) }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{editor === 'new' ? 'Add period' : 'Edit period'}</DialogTitle><DialogDescription>Saved periods are visible to everyone, including visitors who are not signed in.</DialogDescription></DialogHeader>
        {editor && <RoutineForm key={editor === 'new' ? 'new' : editor.id} classId={selected} entry={editor === 'new' ? undefined : editor} settings={query.data?.settings?.find(row => row.class_id === (editor === 'new' ? selected : editor.class_id))} onSaved={() => setEditor(null)} />}
      </DialogContent></Dialog>
      <Dialog open={Boolean(deleting)} onOpenChange={open => { if (!open && !remove.isPending) setDeleting(null) }}><DialogContent><DialogHeader><DialogTitle>Remove this period?</DialogTitle><DialogDescription>{deleting?.subject_name} will be removed from the published class routine.</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="ghost" disabled={remove.isPending} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>{remove.isPending ? 'Removing...' : 'Remove period'}</Button></div></DialogContent></Dialog>
    </>}
  </div>
  return publicView ? <main className="mx-auto min-h-screen max-w-7xl p-2 sm:p-8">{content}</main> : content
}

function RoutineForm({ classId, entry, settings, onSaved }: { classId: string; entry?: RoutineEntry; settings?: RoutineSettings; onSaved: () => void }) {
  const [day, setDay] = useState(String(entry?.day_of_week ?? 0))
  const [start, setStart] = useState(entry?.start_time.slice(0, 5) ?? settings?.periods[0]?.start_time.slice(0, 5) ?? '08:30')
  const [end, setEnd] = useState(entry?.end_time.slice(0, 5) ?? settings?.periods[0]?.end_time.slice(0, 5) ?? '09:15')
  const [subject, setSubject] = useState(entry?.subject_name ?? '')
  const [subjectBn, setSubjectBn] = useState(entry?.subject_name_bn ?? '')
  const [kind, setKind] = useState<NonNullable<RoutineEntry['entry_kind']>>(entry?.entry_kind ?? 'lesson')
  const [teacher, setTeacher] = useState(entry?.teacher_name ?? '')
  const [room, setRoom] = useState(entry?.room ?? '')
  const qc = useQueryClient()
  const save = useMutation({ mutationFn: () => classRoutinesService.save({ class_id: entry?.class_id ?? classId, day_of_week: Number(day), start_time: start, end_time: end, subject_name: subject.trim(), subject_name_bn: subjectBn.trim(), entry_kind: kind, teacher_name: teacher.trim(), room: room.trim() }, entry?.id), onSuccess: () => {
    void qc.invalidateQueries({ queryKey: ['class-routines'] }); toast.success('Class routine saved.'); onSaved()
  }, onError: (error: Error) => toast.error(error.message) })
  const valid = subject.trim().length > 0 && start && end && start < end
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (valid && !save.isPending) save.mutate() }}>
    <div className="space-y-1.5"><Label htmlFor="routine-day">Day</Label><Select value={day} onValueChange={setDay}><SelectTrigger id="routine-day" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{days.map((name, index) => <SelectItem key={name} value={String(index)}>{name}</SelectItem>)}</SelectContent></Select></div>
    <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label htmlFor="routine-start">Start time</Label><Input id="routine-start" type="time" required value={start} onChange={event => setStart(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="routine-end">End time</Label><Input id="routine-end" type="time" required value={end} onChange={event => setEnd(event.target.value)} /></div></div>
    {start && end && start >= end && <p role="alert" className="text-xs text-destructive">End time must be after start time.</p>}
    <div className="space-y-1.5"><Label htmlFor="routine-subject">Subject</Label><Input id="routine-subject" required maxLength={160} value={subject} onChange={event => setSubject(event.target.value)} placeholder="Subject or elective subjects" /></div>
    <div className="space-y-1.5"><Label htmlFor="routine-subject-bn">Bangla name</Label><Input id="routine-subject-bn" lang="bn" maxLength={240} value={subjectBn} onChange={event => setSubjectBn(event.target.value)} /></div>
    <div className="space-y-1.5"><Label htmlFor="routine-kind">Period type</Label><Select value={kind} onValueChange={value => setKind(value as typeof kind)}><SelectTrigger id="routine-kind" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="lesson">Class</SelectItem><SelectItem value="lab">Practical / lab</SelectItem><SelectItem value="support">Academic support</SelectItem><SelectItem value="activity">Activity / games</SelectItem></SelectContent></Select></div>
    <div className="space-y-1.5"><Label htmlFor="routine-teacher">Teacher (optional, public)</Label><Input id="routine-teacher" maxLength={120} value={teacher} onChange={event => setTeacher(event.target.value)} /></div>
    <div className="space-y-1.5"><Label htmlFor="routine-room">Room (optional)</Label><Input id="routine-room" maxLength={80} value={room} onChange={event => setRoom(event.target.value)} /></div>
    <div className="flex justify-end"><Button type="submit" disabled={!valid || save.isPending}>{save.isPending ? 'Saving...' : 'Save period'}</Button></div>
  </form>
}
