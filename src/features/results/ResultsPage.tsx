import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Eye, FilePlus2, Link2, Plus, Printer, Save, Send } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useClasses } from '@/hooks/useClasses'
import { PageHeader, EmptyState, ErrorState, LoadingState } from '@/components/shared/PageHeader'
import { ResultSheet } from '@/features/results/ResultSheet'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ResultExam, ResultExamType, StudentResultPayload, Student } from '@/types/database'

// Result tables/RPCs are introduced by the accompanying migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

interface ExamWithDetails extends ResultExam {
  result_exam_types: { name: string }
  academic_years: { name: string }
  classes: { name: string; grade: string; section: string }
}

interface ExamSubject {
  id: string
  exam_id: string
  subject_id: string
  creative_max: number
  written_max: number
  practical_max: number
  pass_mark: number
  sort_order: number
  subjects: { id: string; name: string; code: string }
}

interface MarkRow {
  id: string
  exam_subject_id: string
  student_id: string
  creative_marks: number | null
  written_marks: number | null
  practical_marks: number | null
  is_absent: boolean
  remarks: string | null
}

interface MarkDraft {
  creative: string
  written: string
  practical: string
  absent: boolean
}

export function ResultsPage() {
  const { role } = useAuth()
  return role === 'student' ? <StudentResults /> : <StaffResults />
}

function StudentResults() {
  const { student } = useAuth()
  const [examId, setExamId] = useState('')
  const examsQuery = useQuery<ExamWithDetails[]>({
    queryKey: ['student-result-exams', student?.id],
    enabled: Boolean(student?.id),
    queryFn: async () => {
      const { data, error } = await db.from('result_exams')
        .select('*, result_exam_types(name), academic_years(name), classes(name, grade, section)')
        .eq('status', 'published').order('exam_date', { ascending: false })
      if (error) throw error
      return data as ExamWithDetails[]
    },
  })

  useEffect(() => {
    if (!examId && examsQuery.data?.[0]) setExamId(examsQuery.data[0].id)
  }, [examId, examsQuery.data])

  const resultQuery = useQuery<StudentResultPayload>({
    queryKey: ['student-result', examId, student?.id],
    enabled: Boolean(examId && student?.id),
    queryFn: async () => {
      const { data, error } = await db.rpc('get_student_result', { p_exam_id: examId, p_student_id: student!.id })
      if (error) throw error
      return data as StudentResultPayload
    },
  })

  if (examsQuery.isLoading) return <LoadingState />
  if (examsQuery.error) return <ErrorState message={(examsQuery.error as Error).message} />
  return (
    <div>
      <PageHeader title="My Results" description="Published examination results are read-only." action={resultQuery.data ? (
        <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print</Button>
      ) : undefined} />
      {!examsQuery.data?.length ? <EmptyState title="No published results" description="Your results will appear here after publication." /> : (
        <>
          <div className="mb-5 max-w-md">
            <Label>Examination</Label>
            <Select value={examId} onValueChange={setExamId}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{examsQuery.data.map(exam => (
                <SelectItem key={exam.id} value={exam.id}>{exam.result_exam_types.name} · {exam.classes.name} · {exam.exam_date}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          {resultQuery.isLoading ? <LoadingState /> : resultQuery.error ? <ErrorState message={(resultQuery.error as Error).message} /> : resultQuery.data ? <ResultSheet result={resultQuery.data} /> : null}
        </>
      )}
    </div>
  )
}

function StaffResults() {
  const { profile, user, can } = useAuth()
  const canWrite = can('results', 'write')
  const isAdmin = profile?.role === 'admin'
  const qc = useQueryClient()
  const { data: classes = [], isLoading: classesLoading } = useClasses()
  const [classId, setClassId] = useState('')
  const [examId, setExamId] = useState('')
  const [examSubjectId, setExamSubjectId] = useState('')
  const [previewStudentId, setPreviewStudentId] = useState('')
  const [examDialog, setExamDialog] = useState(false)
  const [subjectDialog, setSubjectDialog] = useState(false)
  const [configDialog, setConfigDialog] = useState(false)
  const [typeDialog, setTypeDialog] = useState(false)
  const [examForm, setExamForm] = useState({ typeId: '', title: '', date: '' })
  const [subjectForm, setSubjectForm] = useState({ name: '', code: '' })
  const [typeName, setTypeName] = useState('')
  const [config, setConfig] = useState({ subjectId: '', creative: '40', written: '40', practical: '20', pass: '33' })
  const [drafts, setDrafts] = useState<Record<string, MarkDraft>>({})
  const [shareUrl, setShareUrl] = useState('')

  useEffect(() => {
    if (!classId && classes[0]) setClassId(classes[0].id)
  }, [classId, classes])

  const selectedClass = classes.find(item => item.id === classId)

  const examTypesQuery = useQuery<ResultExamType[]>({
    queryKey: ['result-exam-types'],
    queryFn: async () => {
      const { data, error } = await db.from('result_exam_types').select('*').eq('is_active', true).order('sort_order').order('name')
      if (error) throw error
      return data as ResultExamType[]
    },
  })

  const subjectsQuery = useQuery<{ id: string; name: string; code: string }[]>({
    queryKey: ['result-subjects', classId], enabled: Boolean(classId),
    queryFn: async () => {
      const { data, error } = await db.from('subjects').select('id,name,code').eq('class_id', classId).eq('is_active', true).order('name')
      if (error) throw error
      return data
    },
  })

  const examsQuery = useQuery<ExamWithDetails[]>({
    queryKey: ['result-exams', classId], enabled: Boolean(classId),
    queryFn: async () => {
      const { data, error } = await db.from('result_exams')
        .select('*, result_exam_types(name), academic_years(name), classes(name, grade, section)')
        .eq('class_id', classId).order('exam_date', { ascending: false })
      if (error) throw error
      return data as ExamWithDetails[]
    },
  })

  useEffect(() => {
    if (examId && !examsQuery.data?.some(item => item.id === examId)) setExamId('')
  }, [examId, examsQuery.data])

  const selectedExam = examsQuery.data?.find(item => item.id === examId)
  const examSubjectsQuery = useQuery<ExamSubject[]>({
    queryKey: ['result-exam-subjects', examId], enabled: Boolean(examId),
    queryFn: async () => {
      const { data, error } = await db.from('result_exam_subjects').select('*, subjects(id,name,code)').eq('exam_id', examId).order('sort_order')
      if (error) throw error
      return data as ExamSubject[]
    },
  })

  useEffect(() => {
    const items = examSubjectsQuery.data
    if (examSubjectId && !items?.some(item => item.id === examSubjectId)) setExamSubjectId('')
    if (!examSubjectId && items?.[0]) setExamSubjectId(items[0].id)
  }, [examSubjectId, examSubjectsQuery.data])

  const selectedExamSubject = examSubjectsQuery.data?.find(item => item.id === examSubjectId)
  const studentsQuery = useQuery<Student[]>({
    queryKey: ['result-roster', selectedExam?.class_id, selectedExam?.exam_date], enabled: Boolean(selectedExam),
    queryFn: async () => {
      const { data, error } = await db.rpc('get_class_students_for_period', {
        p_class_id: selectedExam!.class_id, p_start_date: selectedExam!.exam_date, p_end_date: selectedExam!.exam_date,
      })
      if (error) throw error
      return (data as Student[]).sort((a, b) => (a.roll_number ?? 99999) - (b.roll_number ?? 99999) || a.admission_number.localeCompare(b.admission_number))
    },
  })

  const marksQuery = useQuery<MarkRow[]>({
    queryKey: ['result-marks', examSubjectId], enabled: Boolean(examSubjectId),
    queryFn: async () => {
      const { data, error } = await db.from('result_marks').select('*').eq('exam_subject_id', examSubjectId)
      if (error) throw error
      return data as MarkRow[]
    },
  })

  useEffect(() => {
    if (!studentsQuery.data || !examSubjectId) return
    const byStudent = new Map((marksQuery.data ?? []).map(mark => [mark.student_id, mark]))
    setDrafts(Object.fromEntries(studentsQuery.data.map(student => {
      const mark = byStudent.get(student.id)
      return [student.id, {
        creative: mark?.creative_marks?.toString() ?? '', written: mark?.written_marks?.toString() ?? '',
        practical: mark?.practical_marks?.toString() ?? '', absent: mark?.is_absent ?? false,
      }]
    })))
  }, [examSubjectId, marksQuery.data, studentsQuery.data])

  const previewQuery = useQuery<StudentResultPayload>({
    queryKey: ['result-preview', examId, previewStudentId], enabled: Boolean(examId && previewStudentId),
    queryFn: async () => {
      const { data, error } = await db.rpc('get_student_result', { p_exam_id: examId, p_student_id: previewStudentId })
      if (error) throw error
      return data as StudentResultPayload
    },
  })

  const createExam = async () => {
    if (!selectedClass?.academic_year_id || !examForm.typeId || !examForm.date) return toast.error('Select exam type and date')
    const { data, error } = await db.from('result_exams').insert({
      class_id: selectedClass.id, academic_year_id: selectedClass.academic_year_id,
      exam_type_id: examForm.typeId, title: examForm.title.trim() || null,
      exam_date: examForm.date, created_by: user?.id,
    }).select('id').single()
    if (error) return toast.error(error.message)
    await qc.invalidateQueries({ queryKey: ['result-exams', classId] })
    setExamDialog(false); setExamForm({ typeId: '', title: '', date: '' }); setExamId(data.id)
    toast.success('Exam created')
  }

  const createSubject = async () => {
    if (!subjectForm.name.trim() || !subjectForm.code.trim()) return toast.error('Subject name and code are required')
    const { error } = await db.from('subjects').insert({ ...subjectForm, name: subjectForm.name.trim(), code: subjectForm.code.trim().toUpperCase(), class_id: classId, is_active: true })
    if (error) return toast.error(error.message)
    setSubjectDialog(false); setSubjectForm({ name: '', code: '' })
    await qc.invalidateQueries({ queryKey: ['result-subjects', classId] }); toast.success('Subject added')
  }

  const createExamType = async () => {
    if (!typeName.trim()) return
    const { error } = await db.from('result_exam_types').insert({ name: typeName.trim(), created_by: user?.id })
    if (error) return toast.error(error.message)
    setTypeName(''); setTypeDialog(false); await qc.invalidateQueries({ queryKey: ['result-exam-types'] }); toast.success('Exam type added')
  }

  const attachSubject = async () => {
    const values = [config.creative, config.written, config.practical, config.pass].map(Number)
    if (!config.subjectId || values.some(Number.isNaN)) return toast.error('Complete the subject marks configuration')
    const { error } = await db.from('result_exam_subjects').insert({
      exam_id: examId, subject_id: config.subjectId, creative_max: values[0], written_max: values[1], practical_max: values[2], pass_mark: values[3],
      sort_order: (examSubjectsQuery.data?.length ?? 0) * 10,
    })
    if (error) return toast.error(error.message)
    setConfigDialog(false); setConfig({ subjectId: '', creative: '40', written: '40', practical: '20', pass: '33' })
    await qc.invalidateQueries({ queryKey: ['result-exam-subjects', examId] }); toast.success('Subject added to exam')
  }

  const saveMarks = useMutation({
    mutationFn: async () => {
      if (!examSubjectId || !studentsQuery.data) return
      const parse = (value: string) => value.trim() === '' ? null : Number(value)
      const rows = studentsQuery.data.map(student => ({
        exam_subject_id: examSubjectId, student_id: student.id,
        creative_marks: drafts[student.id]?.absent ? null : parse(drafts[student.id]?.creative ?? ''),
        written_marks: drafts[student.id]?.absent ? null : parse(drafts[student.id]?.written ?? ''),
        practical_marks: drafts[student.id]?.absent ? null : parse(drafts[student.id]?.practical ?? ''),
        is_absent: drafts[student.id]?.absent ?? false, entered_by: user?.id,
      }))
      const { error } = await db.from('result_marks').upsert(rows, { onConflict: 'exam_subject_id,student_id' })
      if (error) throw error
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['result-marks', examSubjectId] })
      await qc.invalidateQueries({ queryKey: ['result-preview', examId] })
      toast.success('Marks saved')
    },
    onError: error => toast.error((error as Error).message),
  })

  const setStatus = async (status: 'draft' | 'published') => {
    const { error } = await db.from('result_exams').update({ status }).eq('id', examId)
    if (error) return toast.error(error.message)
    await qc.invalidateQueries({ queryKey: ['result-exams', classId] })
    await qc.invalidateQueries({ queryKey: ['result-preview', examId] })
    toast.success(status === 'published' ? 'Result published to students' : 'Result returned to draft')
  }

  const createShareLink = async () => {
    if (!previewStudentId) return toast.error('Select a student first')
    const { data, error } = await db.rpc('create_result_share_link', {
      p_exam_id: examId, p_student_id: previewStudentId, p_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    })
    if (error) return toast.error(error.message)
    const url = `${window.location.origin}/shared-result/${data}`
    setShareUrl(url)
    await navigator.clipboard.writeText(url)
    toast.success('Guardian link copied; it expires in 30 days')
  }

  const unusedSubjects = useMemo(() => subjectsQuery.data?.filter(subject => !examSubjectsQuery.data?.some(item => item.subject_id === subject.id)) ?? [], [subjectsQuery.data, examSubjectsQuery.data])
  if (classesLoading) return <LoadingState />

  return (
    <div>
      <PageHeader title="Student Results" description="Configure exams, enter component marks, publish report cards, and share guardian links." />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:max-w-md"><Label>Class and academic session</Label><Select value={classId} onValueChange={value => { setClassId(value); setExamId(''); setPreviewStudentId('') }}><SelectTrigger className="mt-1"><SelectValue placeholder="Select class" /></SelectTrigger><SelectContent>{classes.map(item => <SelectItem key={item.id} value={item.id}>{item.name} ({item.grade}-{item.section}) · {item.academic_years?.name}</SelectItem>)}</SelectContent></Select></div>
        {isAdmin && <Button variant="outline" onClick={() => setSubjectDialog(true)} disabled={!classId}><Plus className="mr-2 h-4 w-4" /> Subject</Button>}
        {isAdmin && <Button variant="outline" onClick={() => setTypeDialog(true)}><Plus className="mr-2 h-4 w-4" /> Exam type</Button>}
        {canWrite && <Button onClick={() => setExamDialog(true)} disabled={!classId}><FilePlus2 className="mr-2 h-4 w-4" /> New exam</Button>}
      </div>

      {!classId ? <EmptyState title="Select a class" /> : examsQuery.isLoading ? <LoadingState /> : examsQuery.error ? <ErrorState message={(examsQuery.error as Error).message} /> : (
        <Tabs defaultValue="exams">
          <TabsList><TabsTrigger value="exams">Examinations</TabsTrigger><TabsTrigger value="workspace" disabled={!selectedExam}>Marks workspace</TabsTrigger>{previewStudentId && <TabsTrigger value="preview">Report card</TabsTrigger>}</TabsList>
          <TabsContent value="exams" className="mt-4">
            {!examsQuery.data?.length ? <EmptyState title="No examinations" description="Create the first exam for this class." /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{examsQuery.data.map(exam => (
              <Card key={exam.id} className={exam.id === examId ? 'border-primary' : undefined}>
                <CardHeader className="pb-3"><div className="flex items-start justify-between gap-2"><div><CardTitle className="text-base">{exam.title || exam.result_exam_types.name}</CardTitle><CardDescription>{exam.exam_date} · {exam.academic_years.name}</CardDescription></div><Badge variant={exam.status === 'published' ? 'default' : 'secondary'}>{exam.status}</Badge></div></CardHeader>
                <CardContent><Button className="w-full" variant={exam.id === examId ? 'default' : 'outline'} onClick={() => { setExamId(exam.id); setPreviewStudentId('') }}><Eye className="mr-2 h-4 w-4" /> Manage exam</Button></CardContent>
              </Card>
            ))}</div>}
          </TabsContent>

          <TabsContent value="workspace" className="mt-4 space-y-4">
            {selectedExam && <Card><CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>{selectedExam.title || selectedExam.result_exam_types.name}</CardTitle><CardDescription>{selectedExam.classes.name} · {selectedExam.exam_date}</CardDescription></div><div className="flex flex-wrap gap-2">{canWrite && selectedExam.status === 'draft' && <Button variant="outline" onClick={() => setConfigDialog(true)} disabled={!unusedSubjects.length}><Plus className="mr-2 h-4 w-4" /> Add exam subject</Button>}{canWrite && <Button onClick={() => setStatus(selectedExam.status === 'published' ? 'draft' : 'published')}><Send className="mr-2 h-4 w-4" /> {selectedExam.status === 'published' ? 'Unpublish' : 'Publish results'}</Button>}</div></div></CardHeader></Card>}

            {!examSubjectsQuery.data?.length ? <EmptyState title="No subjects configured" description="Add subjects and define their creative, written, practical, and pass marks." /> : <>
              <div className="max-w-lg"><Label>Subject for mark entry</Label><Select value={examSubjectId} onValueChange={setExamSubjectId}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{examSubjectsQuery.data.map(item => <SelectItem key={item.id} value={item.id}>{item.subjects.name} · {item.creative_max + item.written_max + item.practical_max} marks</SelectItem>)}</SelectContent></Select></div>
              {selectedExamSubject && <Card><CardHeader><CardTitle className="text-base">{selectedExamSubject.subjects.name} marks</CardTitle><CardDescription>Creative {selectedExamSubject.creative_max} · Written {selectedExamSubject.written_max} · Practical {selectedExamSubject.practical_max} · Pass {selectedExamSubject.pass_mark}</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Student ID</TableHead><TableHead>Student</TableHead><TableHead className="w-28">Creative</TableHead><TableHead className="w-28">Written</TableHead><TableHead className="w-28">Practical</TableHead><TableHead className="w-24 text-center">Absent</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{studentsQuery.data?.map(student => {
                const draft = drafts[student.id] ?? { creative: '', written: '', practical: '', absent: false }
                const total = [draft.creative, draft.written, draft.practical].reduce((sum, value) => sum + (Number(value) || 0), 0)
                const update = (field: keyof MarkDraft, value: string | boolean) => setDrafts(current => ({ ...current, [student.id]: { ...draft, [field]: value } }))
                return <TableRow key={student.id}><TableCell className="font-mono text-xs">{student.admission_number}</TableCell><TableCell><p className="font-medium">{student.first_name} {student.last_name}</p><p className="text-xs text-muted-foreground">Roll {student.roll_number ?? '—'}</p></TableCell><MarkInput value={draft.creative} max={selectedExamSubject.creative_max} disabled={draft.absent || selectedExam?.status === 'published' || !canWrite} onChange={value => update('creative', value)} /><MarkInput value={draft.written} max={selectedExamSubject.written_max} disabled={draft.absent || selectedExam?.status === 'published' || !canWrite} onChange={value => update('written', value)} /><MarkInput value={draft.practical} max={selectedExamSubject.practical_max} disabled={draft.absent || selectedExam?.status === 'published' || !canWrite} onChange={value => update('practical', value)} /><TableCell className="text-center"><Checkbox checked={draft.absent} disabled={selectedExam?.status === 'published' || !canWrite} onCheckedChange={checked => update('absent', Boolean(checked))} /></TableCell><TableCell className="text-right font-semibold">{draft.absent ? 'Absent' : total}</TableCell></TableRow>
              })}</TableBody></Table></div>{canWrite && selectedExam?.status === 'draft' && <div className="flex justify-end border-t p-4"><Button onClick={() => saveMarks.mutate()} disabled={saveMarks.isPending}><Save className="mr-2 h-4 w-4" /> Save marks</Button></div>}</CardContent></Card>}
            </>}

            <Card><CardHeader><CardTitle className="text-base">Student report and guardian link</CardTitle><CardDescription>Preview a student report. Guardian links work only after publication and expire after 30 days.</CardDescription></CardHeader><CardContent><div className="flex flex-col gap-3 sm:flex-row"><Select value={previewStudentId} onValueChange={value => { setPreviewStudentId(value); setShareUrl('') }}><SelectTrigger className="sm:max-w-md"><SelectValue placeholder="Select student" /></SelectTrigger><SelectContent>{studentsQuery.data?.map(student => <SelectItem key={student.id} value={student.id}>{student.admission_number} · {student.first_name} {student.last_name}</SelectItem>)}</SelectContent></Select>{canWrite && selectedExam?.status === 'published' && <Button variant="outline" onClick={createShareLink}><Link2 className="mr-2 h-4 w-4" /> Create guardian link</Button>}</div>{shareUrl && <div className="mt-3 flex items-center gap-2 rounded-md border bg-muted/40 p-2"><Input readOnly value={shareUrl} /><Button size="icon" variant="ghost" onClick={() => navigator.clipboard.writeText(shareUrl)}><Copy className="h-4 w-4" /></Button></div>}</CardContent></Card>
          </TabsContent>

          <TabsContent value="preview" className="mt-4">{previewQuery.isLoading ? <LoadingState /> : previewQuery.error ? <ErrorState message={(previewQuery.error as Error).message} /> : previewQuery.data ? <><div className="mb-3 flex justify-end"><Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print</Button></div><ResultSheet result={previewQuery.data} /></> : null}</TabsContent>
        </Tabs>
      )}

      <SimpleDialog open={examDialog} onOpenChange={setExamDialog} title="Create examination" description="Create a draft exam for the selected class." onSave={createExam} saveLabel="Create exam"><Label>Exam type</Label><Select value={examForm.typeId} onValueChange={value => setExamForm(current => ({ ...current, typeId: value }))}><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger><SelectContent>{examTypesQuery.data?.map(type => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent></Select><Label>Custom title (optional)</Label><Input value={examForm.title} onChange={event => setExamForm(current => ({ ...current, title: event.target.value }))} placeholder="e.g. First Monthly Exam" /><Label>Exam date</Label><Input type="date" value={examForm.date} min={selectedClass?.academic_years?.start_date} max={selectedClass?.academic_years?.end_date} onChange={event => setExamForm(current => ({ ...current, date: event.target.value }))} /></SimpleDialog>
      <SimpleDialog open={subjectDialog} onOpenChange={setSubjectDialog} title="Add class subject" description="Only full administrators can maintain subjects." onSave={createSubject} saveLabel="Add subject"><Label>Subject name</Label><Input value={subjectForm.name} onChange={event => setSubjectForm(current => ({ ...current, name: event.target.value }))} placeholder="Bangla" /><Label>Subject code</Label><Input value={subjectForm.code} onChange={event => setSubjectForm(current => ({ ...current, code: event.target.value }))} placeholder="BAN-101" /></SimpleDialog>
      <SimpleDialog open={typeDialog} onOpenChange={setTypeDialog} title="Add exam type" description="Examples: Mid Term, Final, Test, Monthly Exam." onSave={createExamType} saveLabel="Add type"><Label>Name</Label><Input value={typeName} onChange={event => setTypeName(event.target.value)} placeholder="Practical Test" /></SimpleDialog>
      <SimpleDialog open={configDialog} onOpenChange={setConfigDialog} title="Configure exam subject" description="Set the component maximums and total pass mark." onSave={attachSubject} saveLabel="Add to exam"><Label>Subject</Label><Select value={config.subjectId} onValueChange={value => setConfig(current => ({ ...current, subjectId: value }))}><SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger><SelectContent>{unusedSubjects.map(subject => <SelectItem key={subject.id} value={subject.id}>{subject.name} ({subject.code})</SelectItem>)}</SelectContent></Select><div className="grid grid-cols-2 gap-3"><NumberField label="Creative max" value={config.creative} onChange={value => setConfig(current => ({ ...current, creative: value }))} /><NumberField label="Written max" value={config.written} onChange={value => setConfig(current => ({ ...current, written: value }))} /><NumberField label="Practical max" value={config.practical} onChange={value => setConfig(current => ({ ...current, practical: value }))} /><NumberField label="Pass mark" value={config.pass} onChange={value => setConfig(current => ({ ...current, pass: value }))} /></div></SimpleDialog>
    </div>
  )
}

function MarkInput({ value, max, disabled, onChange }: { value: string; max: number; disabled: boolean; onChange: (value: string) => void }) {
  return <TableCell><Input type="number" min={0} max={max} step="0.01" value={value} disabled={disabled || max <= 0} placeholder={max <= 0 ? 'N/A' : `/${max}`} onChange={event => onChange(event.target.value)} /></TableCell>
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div><Label>{label}</Label><Input type="number" min={0} step="0.01" value={value} onChange={event => onChange(event.target.value)} /></div>
}

function SimpleDialog({ open, onOpenChange, title, description, onSave, saveLabel, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; onSave: () => unknown | Promise<unknown>; saveLabel: string; children: React.ReactNode }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div className="space-y-3">{children}</div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void onSave()}>{saveLabel}</Button></DialogFooter></DialogContent></Dialog>
}
