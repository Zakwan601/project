import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { SimpleDialog } from '@/features/results/ResultControls'
import type { ClassGroup } from '@/types/database'
import type { ExamWithDetails } from '@/features/results/result-model'

const db = supabase as any

interface RoutineSubject {
  id: string
  name: string
  code: string
  class_group: ClassGroup
}

interface RoutinePaperGroup {
  id: string
  name: string
  code: string
  class_group: ClassGroup
  first_paper_subject_id: string
  second_paper_subject_id: string
}

interface ExamRoutineRow {
  id: string
  exam_group_id: string
  subject_id: string | null
  subject_name: string
  exam_date: string
  exam_time: string | null
  has_regular_classes: boolean
  subjects: { name: string; code: string } | null
  result_exam_schedule_classes: Array<{ exam_id: string; result_exams: ExamWithDetails }>
}

const emptyForm = { examIds: [] as string[], subjectId: '', date: '', time: '' }

function displayTime(value: string | null) {
  if (!value) return 'Not required'
  const [hours, minutes] = value.split(':').map(Number)
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function ExamScheduleManager({
  examGroupId,
  classId,
  canWrite,
  hasRegularClasses,
  combineSubjectPapers,
}: {
  examGroupId: string
  classId: string
  canWrite: boolean
  hasRegularClasses: boolean
  combineSubjectPapers: boolean
}) {
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const examsQuery = useQuery<ExamWithDetails[]>({
    queryKey: ['result-exam-group', examGroupId],
    queryFn: async () => {
      const { data, error } = await db.from('result_exams')
        .select('*, result_exam_types(name), academic_years(name,start_date,end_date), classes(name,grade,section,class_group)')
        .eq('exam_group_id', examGroupId)
        .order('class_id')
      if (error) throw error
      return data as ExamWithDetails[]
    },
  })

  const subjectsQuery = useQuery<RoutineSubject[]>({
    queryKey: ['result-routine-subjects'],
    queryFn: async () => {
      const { data, error } = await db.from('subjects')
        .select('id,name,code,class_group')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data as RoutineSubject[]
    },
  })

  const paperGroupsQuery = useQuery<RoutinePaperGroup[]>({
    queryKey: ['result-routine-paper-groups'],
    queryFn: async () => {
      const { data, error } = await db.from('result_subject_paper_groups')
        .select('id,name,code,class_group,first_paper_subject_id,second_paper_subject_id')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data as RoutinePaperGroup[]
    },
  })

  const routineQuery = useQuery<ExamRoutineRow[]>({
    queryKey: ['result-exam-routine', examGroupId, classId],
    queryFn: async () => {
      const { data, error } = await db.from('result_exam_schedules')
        .select('*, subjects(name,code), result_exam_schedule_classes(exam_id, result_exams(*, result_exam_types(name), academic_years(name), classes(name,grade,section,class_group)))')
        .eq('exam_group_id', examGroupId)
        .order('exam_date')
        .order('exam_time')
      if (error) throw error
      return data as ExamRoutineRow[]
    },
  })

  const groupExams = examsQuery.data ?? []
  const currentExam = groupExams.find(exam => exam.class_id === classId)
  const selectedExams = currentExam ? [currentExam] : []
  const selectedGroups = new Set(selectedExams.map(exam => exam.classes.class_group))
  const modeCombinesPapers = groupExams[0]?.combine_subject_papers ?? combineSubjectPapers
  const availableSubjects = useMemo(() => {
    const catalogue = (subjectsQuery.data ?? []).filter(subject => !selectedGroups.size
      || (selectedGroups.size === 1 && selectedGroups.has(subject.class_group)))
    if (!modeCombinesPapers) return catalogue

    const byId = new Map(catalogue.map(subject => [subject.id, subject]))
    const pairedIds = new Set<string>()
    const combined = (paperGroupsQuery.data ?? []).flatMap(group => {
      const first = byId.get(group.first_paper_subject_id)
      const second = byId.get(group.second_paper_subject_id)
      if (!first || !second) return []
      pairedIds.add(first.id)
      pairedIds.add(second.id)
      return [{ ...first, name: group.name, code: group.code }]
    })
    return [...catalogue.filter(subject => !pairedIds.has(subject.id)), ...combined]
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [modeCombinesPapers, paperGroupsQuery.data, selectedGroups, subjectsQuery.data])
  const modeHasClasses = groupExams[0]?.has_regular_classes ?? hasRegularClasses
  const dateMin = selectedExams.reduce<string | undefined>((latest, exam) => {
    const start = exam.academic_years.start_date
    return start && (!latest || start > latest) ? start : latest
  }, undefined)
  const dateMax = selectedExams.reduce<string | undefined>((earliest, exam) => {
    const end = exam.academic_years.end_date
    return end && (!earliest || end < earliest) ? end : earliest
  }, undefined)

  const openRoutineDialog = () => {
    setForm({ ...emptyForm, examIds: currentExam ? [currentExam.id] : [] })
    setDialogOpen(true)
  }

  const createRoutineRow = async () => {
    if (!currentExam || !form.subjectId || !form.date) return toast.error('Select a subject and a date')
    if (!modeHasClasses && !form.time) return toast.error('Exam time is required for an exam-only examination')
    setSaving(true)
    const { error } = await db.rpc('create_result_exam_routine_entry', {
      p_exam_ids: [currentExam.id],
      p_subject_id: form.subjectId,
      p_exam_date: form.date,
      p_exam_time: form.time || null,
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    await qc.invalidateQueries({ queryKey: ['result-exam-routine', examGroupId] })
    await qc.invalidateQueries({ queryKey: ['student_attendance_statistics'] })
    await qc.invalidateQueries({ queryKey: ['student_attendance_fine_details'] })
    await qc.invalidateQueries({ queryKey: ['class_attendance_fine_details'] })
    setDialogOpen(false)
    setForm({ ...emptyForm })
    toast.success('Routine row added')
  }

  return <>
    <Card className="border-0 bg-transparent shadow-none">
      <CardHeader className="grid grid-cols-1 gap-3 px-0 pb-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-0">
        <div>
          <CardTitle>Examination routine</CardTitle>
          <CardDescription className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={modeHasClasses ? 'secondary' : 'default'}>{modeHasClasses ? 'Exam + classes' : 'Exam only'}</Badge>
            <Badge variant="outline">{modeCombinesPapers ? 'Combined papers' : 'Separate papers'}</Badge>
            <span>{currentExam ? `${currentExam.classes.name}` : 'This class has its own routine.'}</span>
          </CardDescription>
        </div>
        {canWrite && <Button size="sm" className="w-full self-start sm:w-auto" onClick={openRoutineDialog}>Add routine row</Button>}
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        {routineQuery.isLoading ? <div className="overflow-hidden rounded-md border">{Array.from({ length: 5 }, (_, index) => <div key={index} className="grid min-h-12 grid-cols-[minmax(8rem,1fr)_7rem_6rem] items-center gap-3 border-b px-3 last:border-b-0"><Skeleton className="h-3 w-36 max-w-full" /><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-16" /></div>)}</div>
          : routineQuery.error ? <p className="py-8 text-center text-sm text-destructive">{(routineQuery.error as Error).message}</p>
            : !routineQuery.data?.some(row => row.result_exam_schedule_classes.some(link => link.exam_id === currentExam?.id)) ? <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">No routine rows added for this class yet.</p>
              : <div className="overflow-x-auto"><Table className="min-w-[480px]"><TableHeader><TableRow><TableHead>Subject</TableHead><TableHead>Date</TableHead><TableHead>Time</TableHead></TableRow></TableHeader><TableBody>{routineQuery.data.filter(row => row.result_exam_schedule_classes.some(link => link.exam_id === currentExam?.id)).map(row => <TableRow key={row.id}><TableCell><span className="font-medium">{row.subject_name || row.subjects?.name}</span>{!modeCombinesPapers && row.subjects?.code && <span className="ml-2 text-xs text-muted-foreground">{row.subjects.code}</span>}</TableCell><TableCell>{format(new Date(`${row.exam_date}T00:00:00`), 'dd MMM yyyy')}</TableCell><TableCell>{displayTime(row.exam_time)}</TableCell></TableRow>)}</TableBody></Table></div>}
      </CardContent>
    </Card>

    <SimpleDialog open={dialogOpen} onOpenChange={setDialogOpen} title="Add routine row" description={`Add this row only to ${currentExam?.classes.name ?? 'the current class'}.`} onSave={createRoutineRow} saveLabel={saving ? 'Adding...' : 'Add to routine'}>
      <Label>Subject</Label>
      <Select value={form.subjectId} onValueChange={subjectId => setForm(current => ({ ...current, subjectId }))}>
        <SelectTrigger><SelectValue placeholder="Choose subject" /></SelectTrigger>
        <SelectContent>{availableSubjects.map(subject => <SelectItem key={subject.id} value={subject.id}>{subject.name} ({subject.code})</SelectItem>)}</SelectContent>
      </Select>
      <Label>Date</Label>
      <Input type="date" value={form.date} min={dateMin} max={dateMax} onChange={event => setForm(current => ({ ...current, date: event.target.value }))} />
      <Label>Exam time {modeHasClasses ? '(optional)' : '(required)'}</Label>
      <Input type="time" value={form.time} onChange={event => setForm(current => ({ ...current, time: event.target.value }))} />
    </SimpleDialog>
  </>
}
