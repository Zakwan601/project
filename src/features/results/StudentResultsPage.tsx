import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CalendarDays, Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/shared/PageHeader'
import { ResultSheet } from '@/features/results/ResultSheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { StudentResultPayload } from '@/types/database'
import type { ExamWithDetails } from '@/features/results/result-model'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

interface StudentRoutineRow {
  id: string
  subject_name: string
  exam_date: string
  exam_time: string | null
}

function displayRoutineTime(value: string | null) {
  if (!value) return 'Not specified'
  const [hours, minutes] = value.split(':').map(Number)
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function StudentResultsPage() {
  const { student } = useAuth()
  const [examId, setExamId] = useState('')

  const examsQuery = useQuery<ExamWithDetails[]>({
    queryKey: ['student-result-exams', student?.id],
    enabled: Boolean(student?.id),
    queryFn: async () => {
      const { data, error } = await db.from('result_exams')
        .select('*, result_exam_types(name), academic_years(name), classes(name, grade, section, class_group)')
        .order('exam_date', { ascending: false })
      if (error) throw error
      return data as ExamWithDetails[]
    },
  })

  useEffect(() => {
    if (!examId && examsQuery.data?.[0]) setExamId(examsQuery.data[0].id)
  }, [examId, examsQuery.data])

  const selectedExam = examsQuery.data?.find(exam => exam.id === examId)

  const routineQuery = useQuery<StudentRoutineRow[]>({
    queryKey: ['student-exam-routine', examId],
    enabled: Boolean(examId),
    queryFn: async () => {
      const { data, error } = await db.from('result_exam_schedules')
        .select('id,subject_name,exam_date,exam_time,result_exam_schedule_classes!inner(exam_id)')
        .eq('result_exam_schedule_classes.exam_id', examId)
        .order('exam_date')
        .order('exam_time')
      if (error) throw error
      return data as StudentRoutineRow[]
    },
  })

  const resultQuery = useQuery<StudentResultPayload>({
    queryKey: ['student-result', examId, student?.id],
    enabled: Boolean(examId && student?.id && selectedExam?.status === 'published'),
    queryFn: async () => {
      const { data, error } = await db.rpc('get_student_result', { p_exam_id: examId, p_student_id: student!.id })
      if (error) throw error
      return data as StudentResultPayload
    },
  })

  if (examsQuery.isLoading) return <LoadingState />
  if (examsQuery.error) return <ErrorState message={(examsQuery.error as Error).message} />

  return <div>
    <PageHeader
      title="My Examinations & Results"
      description="View your examination routine and published results."
      action={resultQuery.data ? <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print</Button> : undefined}
    />
    {!examsQuery.data?.length ? <EmptyState title="No examinations available" description="Your examination routines and results will appear here." /> : <>
      <div className="mb-5 max-w-md">
        <Label>Examination</Label>
        <Select value={examId} onValueChange={setExamId}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>{examsQuery.data.map(exam => <SelectItem key={exam.id} value={exam.id}>{exam.title || exam.result_exam_types.name} · {exam.classes.name} · {exam.exam_date}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Examination routine</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            {selectedExam && <Badge variant={selectedExam.has_regular_classes ? 'secondary' : 'default'}>{selectedExam.has_regular_classes ? 'Exam + classes' : 'Exam only'}</Badge>}
            {selectedExam && <Badge variant="outline">{selectedExam.combine_subject_papers ? 'Combined papers' : 'Separate papers'}</Badge>}
            <span>{selectedExam?.classes.name}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {routineQuery.isLoading ? <LoadingState message="Loading examination routine..." />
            : routineQuery.error ? <ErrorState message={(routineQuery.error as Error).message} />
              : !routineQuery.data?.length ? <EmptyState title="Routine not available" description="No routine rows have been added for this examination yet." />
                : <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Subject</TableHead><TableHead>Date</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
                    <TableBody>{routineQuery.data.map(row => <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.subject_name}</TableCell>
                      <TableCell className="whitespace-nowrap">{format(new Date(`${row.exam_date}T00:00:00`), 'dd MMM yyyy')}</TableCell>
                      <TableCell className="whitespace-nowrap">{displayRoutineTime(row.exam_time)}</TableCell>
                    </TableRow>)}</TableBody>
                  </Table>
                </div>}
        </CardContent>
      </Card>

      {selectedExam?.status !== 'published'
        ? <EmptyState title="Results not published" description="Your result will appear here after it is published." />
        : resultQuery.isLoading ? <LoadingState />
          : resultQuery.error ? <ErrorState message={(resultQuery.error as Error).message} />
            : resultQuery.data ? <ResultSheet result={resultQuery.data} /> : null}
    </>}
  </div>
}
