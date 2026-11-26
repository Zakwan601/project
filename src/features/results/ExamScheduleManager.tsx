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
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { SimpleDialog } from '@/features/results/ResultControls'
import { buildExamSubjectCatalogue, type ClassSubject, type ExamWithDetails, type ResultSubjectPaperGroup } from '@/features/results/result-model'
import { groupExamRoutineSlots } from '@/features/results/routine-model'

const db = supabase as any

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

const emptyForm = { subjectIds: [] as string[], date: '', time: '' }

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
        .select('*, result_exam_types(name,marks_mode), academic_years(name,start_date,end_date), classes(name,grade,section,class_group)')
        .eq('exam_group_id', examGroupId)
        .order('class_id')
      if (error) throw error
      return data as ExamWithDetails[]
    },
  })

  const subjectsQuery = useQuery<ClassSubject[]>({
    queryKey: ['result-routine-subjects'],
    queryFn: async () => {
      const { data, error } = await db.from('subjects')
        .select('id,name,code,class_group,is_active,is_fourth_subject')
        .order('name')
      if (error) throw error
      return data as ClassSubject[]
    },
  })

  const paperGroupsQuery = useQuery<ResultSubjectPaperGroup[]>({
    queryKey: ['result-routine-paper-groups'],
    queryFn: async () => {
      const { data, error } = await db.from('result_subject_paper_groups')
        .select('id,name,code,class_group,first_paper_subject_id,second_paper_subject_id,is_active')
        .order('name')
      if (error) throw error
      return data as ResultSubjectPaperGroup[]
    },
  })

  const routineQuery = useQuery<ExamRoutineRow[]>({
    queryKey: ['result-exam-routine', examGroupId, classId],
    queryFn: async () => {
      const { data, error } = await db.from('result_exam_schedules')
        .select('*, subjects(name,code), result_exam_schedule_classes(exam_id, result_exams(*, result_exam_types(name,marks_mode), academic_years(name), classes(name,grade,section,class_group)))')
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
  const selectedClassGroup = currentExam?.classes.class_group
  const modeCombinesPapers = currentExam?.combine_subject_papers ?? combineSubjectPapers
  const availableSubjects = useMemo(() => {
    const catalogue = (subjectsQuery.data ?? []).filter(subject => subject.is_active && subject.class_group === selectedClassGroup)
    return buildExamSubjectCatalogue(catalogue, paperGroupsQuery.data ?? [], modeCombinesPapers)
  }, [modeCombinesPapers, paperGroupsQuery.data, selectedClassGroup, subjectsQuery.data])
  const routineSubjectName = (row: ExamRoutineRow) => {
    const group = modeCombinesPapers ? paperGroupsQuery.data?.find(group =>
      group.first_paper_subject_id === row.subject_id || group.second_paper_subject_id === row.subject_id,
    ) : undefined
    return group?.name || row.subject_name || row.subjects?.name
  }
  const modeHasClasses = currentExam?.has_regular_classes ?? hasRegularClasses
  const routineSlots = groupExamRoutineSlots((routineQuery.data ?? [])
    .filter(row => row.result_exam_schedule_classes.some(link => link.exam_id === currentExam?.id))
    .map(row => ({ ...row, subject_name: routineSubjectName(row) ?? '' })))
  const dateMin = selectedExams.reduce<string | undefined>((latest, exam) => {
    const start = exam.academic_years.start_date
    return start && (!latest || start > latest) ? start : latest
  }, undefined)
  const dateMax = selectedExams.reduce<string | undefined>((earliest, exam) => {
    const end = exam.academic_years.end_date
    return end && (!earliest || end < earliest) ? end : earliest
  }, undefined)

  const openRoutineDialog = () => {
    if (examsQuery.isLoading || subjectsQuery.isLoading || paperGroupsQuery.isLoading) return toast.info('Loading subject choices…')
    if (examsQuery.error || subjectsQuery.error || paperGroupsQuery.error) return toast.error('Subject choices could not be loaded. Please try again.')
    setForm({ ...emptyForm })
    setDialogOpen(true)
  }

  const createRoutineRow = async () => {
    if (saving) return
    if (!currentExam || !form.subjectIds.length || !form.date) return toast.error('Select subjects and a date')
    if (form.subjectIds.some(id => !availableSubjects.some(subject => subject.id === id))) return toast.error('Choose subjects for the current paper mode')
    if (!modeHasClasses && !form.time) return toast.error('Exam time is required for an exam-only examination')
    setSaving(true)
    try {
      const { error } = await db.rpc('create_result_exam_routine_entries', {
        p_exam_id: currentExam.id,
        p_subject_ids: form.subjectIds,
        p_exam_date: form.date,
        p_exam_time: form.time || null,
      })
      if (error) throw new Error(error.message)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['result-exam-routine', examGroupId] }),
        qc.invalidateQueries({ queryKey: ['student-exam-routine'] }),
        qc.invalidateQueries({ queryKey: ['student_attendance_statistics'] }),
        qc.invalidateQueries({ queryKey: ['student_attendance_fine_details'] }),
        qc.invalidateQueries({ queryKey: ['class_attendance_fine_details'] }),
      ])
      setDialogOpen(false)
      setForm({ ...emptyForm })
      toast.success('Routine row added')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save the routine. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return <>
    <Card className="exam-routine-panel border-0 bg-transparent shadow-none">
      <CardHeader className="grid grid-cols-1 gap-3 px-0 pb-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-0">
        <div>
          <CardTitle>Examination routine</CardTitle>
          <CardDescription className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={modeHasClasses ? 'secondary' : 'default'}>{modeHasClasses ? 'Exam + classes' : 'Exam only'}</Badge>
            <Badge variant="outline">{modeCombinesPapers ? 'Combined papers' : 'Separate papers'}</Badge>
            <span className="hidden sm:inline">{currentExam ? `${currentExam.classes.name}` : 'This class has its own routine.'}</span>
          </CardDescription>
        </div>
        {canWrite && <Button size="sm" className="w-full self-start sm:w-auto" onClick={openRoutineDialog}><span className="sm:hidden">Add routine</span><span className="hidden sm:inline">Add routine row</span></Button>}
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        {routineQuery.isLoading ? <div className="overflow-hidden rounded-md border">{Array.from({ length: 5 }, (_, index) => <div key={index} className="grid min-h-12 grid-cols-[minmax(8rem,1fr)_7rem_6rem] items-center gap-3 border-b px-3 last:border-b-0"><Skeleton className="h-3 w-36 max-w-full" /><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-16" /></div>)}</div>
          : routineQuery.error ? <p className="py-8 text-center text-sm text-destructive">{(routineQuery.error as Error).message}</p>
            : !routineSlots.length ? <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">No routine rows added for this class yet.</p>
              : <div className="overflow-x-auto"><Table className="exam-routine-table min-w-[480px]"><TableHeader><TableRow><TableHead>Subject</TableHead><TableHead>Date</TableHead><TableHead>Time</TableHead></TableRow></TableHeader><TableBody>{routineSlots.map(row => <TableRow key={row.id}><TableCell><span className="font-medium">{row.subject_name}</span></TableCell><TableCell>{format(new Date(`${row.exam_date}T00:00:00`), 'dd MMM yyyy')}</TableCell><TableCell>{displayTime(row.exam_time)}</TableCell></TableRow>)}</TableBody></Table></div>}
      </CardContent>
    </Card>

    <SimpleDialog open={dialogOpen} onOpenChange={open => { if (!saving) setDialogOpen(open) }} title="Add routine row" description={`Add this row only to ${currentExam?.classes.name ?? 'the current class'}.`} onSave={createRoutineRow} saveLabel={saving ? 'Adding...' : 'Add to routine'}>
      <fieldset className="space-y-2" disabled={saving}>
        <legend className="text-sm font-medium">Subjects at this time</legend>
        <p className="text-xs text-muted-foreground">Select the alternative subjects held together. Students see the subjects they take.</p>
        <div className="max-h-60 divide-y overflow-y-auto border-y">
          {availableSubjects.map(subject => (
            <label key={subject.id} className="flex cursor-pointer items-start gap-3 py-2.5 text-sm">
              <Checkbox className="mt-0.5" checked={form.subjectIds.includes(subject.id)} onCheckedChange={checked => setForm(current => ({
                ...current, subjectIds: checked === true ? [...new Set([...current.subjectIds, subject.id])] : current.subjectIds.filter(id => id !== subject.id),
              }))} />
              <span>{subject.name} <span className="text-xs text-muted-foreground">({subject.code})</span></span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{form.subjectIds.length} selected</p>
      </fieldset>
      <Label>Date</Label>
      <Input type="date" disabled={saving} value={form.date} min={dateMin} max={dateMax} onChange={event => setForm(current => ({ ...current, date: event.target.value }))} />
      <Label>Exam time {modeHasClasses ? '(optional)' : '(required)'}</Label>
      <Input type="time" disabled={saving} value={form.time} onChange={event => setForm(current => ({ ...current, time: event.target.value }))} />
    </SimpleDialog>
  </>
}
