import { Fragment } from 'react'
import { Table } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { examSubjectShortName, examResultColumns, examResultComponentText,
  type ExamSubject, type ExamResultReportRow, type MarkRow } from './result-model'

export function ExamResultsTable({ subjects, rows, marks, totalOnly, print = false }: {
  subjects: ExamSubject[]; rows: ExamResultReportRow[]; marks: MarkRow[]; totalOnly: boolean; print?: boolean
}) {
  const Root = print ? 'table' : Table
  const groups = subjects.map(subject => ({ subject, columns: examResultColumns(subject, totalOnly), hasFourth: rows.some(row => row.subjects[subject.id]?.role === 'fourth') }))
  const columnWeight = (field: string, hasFourth: boolean) => hasFourth && (field === 'total' || totalOnly) ? 1.8 : 1
  const totalColumnWeight = groups.reduce((sum, group) => sum + group.columns.reduce((weight, column) => weight + columnWeight(column.field, group.hasFourth), 0), 0)
  const fourthMarker = <span className="result-fourth-marker ml-0.5 text-[8px] font-medium sm:text-[9px]"> (4th)</span>
  const markByStudentSubject = new Map(marks.map(mark => [`${mark.student_id}:${mark.exam_subject_id}`, mark]))
  const stickyRoll = print ? '' : 'sticky left-0 z-20 w-12 min-w-12 bg-card'
  const stickyStudent = print ? 'result-student-name' : 'sticky left-12 z-20 min-w-28 max-w-28 border-r bg-card sm:min-w-40 sm:max-w-40'
  const groupBorder = print ? 'result-subject-end' : 'border-r'
  const absent = print ? 'result-absent' : 'bg-red-50 font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300'
  return <Root className={print ? 'exam-results-print-table' : 'w-max min-w-full border-collapse text-[10px] sm:text-xs [&_th]:px-1 [&_th]:py-1 [&_td]:px-1 [&_td]:py-1.5 [&_td]:whitespace-nowrap'}>
    {print && <colgroup>
      <col style={{ width: '2.5%' }} /><col style={{ width: '4%' }} /><col style={{ width: '16%' }} />
      {groups.flatMap(({ subject, columns, hasFourth }) => columns.map(column => <col key={`${subject.id}:${column.field}`} style={{ width: `${(totalOnly ? 69 : 60) * columnWeight(column.field, hasFourth) / totalColumnWeight}%` }} />))}
      <col style={{ width: '5%' }} />{!totalOnly && <><col style={{ width: '3.5%' }} /><col style={{ width: '5.5%' }} /></>}<col style={{ width: '3.5%' }} />
    </colgroup>}
    <thead><tr className="border-b">
      {print && <th rowSpan={2}>SN</th>}
      <th rowSpan={2} className={`${stickyRoll} text-left font-medium`}>Roll</th>
      <th rowSpan={2} className={`${stickyStudent} text-left font-medium`}>Student</th>
      {groups.map(({ subject, columns }) => <th key={subject.id} colSpan={columns.length} scope="colgroup" className={`whitespace-nowrap text-center font-medium ${groupBorder}`} title={subject.result_subject_paper_groups?.name ?? subject.subjects.name}>
        <span className="block font-semibold">{examSubjectShortName(subject)}</span>
        <span className={print ? 'result-subject-code' : 'block text-[9px] font-normal text-muted-foreground'}>{subject.result_subject_paper_groups?.code ?? subject.subjects.code}</span>
      </th>)}
      <th rowSpan={2} className="text-center font-medium">Total</th>
      {!totalOnly && <><th rowSpan={2} className="text-center font-medium">GPA</th><th rowSpan={2} className="text-center font-medium">Grade</th></>}
      <th rowSpan={2} className="text-center font-medium">Pos.</th>
    </tr><tr className="border-b">
      {groups.flatMap(({ subject, columns }) => columns.map((column, index) => <th key={`${subject.id}:${column.field}`} scope="col" className={`min-w-8 text-center font-medium sm:min-w-10 ${index === columns.length - 1 ? groupBorder : ''}`}>
        <span className="block">{column.label}</span><span className={print ? 'result-component-max' : 'block text-[8px] font-normal text-muted-foreground'}>/{column.maximum}</span>
      </th>))}
    </tr></thead>
    <tbody>{rows.map((row, index) => <tr key={row.id} className={print ? undefined : 'border-b hover:bg-muted'}>
      {print && <td>{index + 1}</td>}
      <td className={`${stickyRoll} font-semibold`}>{row.roll ?? '—'}</td>
      <td className={`${stickyStudent} truncate font-medium`} title={row.name}>{row.name}</td>
      {groups.map(({ subject, columns }) => row.subjects[subject.id]?.absent
        ? <td key={subject.id} colSpan={columns.length} className={`text-center ${groupBorder} ${absent}`}>Absent{row.subjects[subject.id]?.role === 'fourth' && fourthMarker}</td>
        : <Fragment key={subject.id}>{columns.map((column, columnIndex) => <td key={column.field} className={`text-center tabular-nums ${columnIndex === columns.length - 1 ? groupBorder : ''}`}>
          {examResultComponentText(row, subject, column, markByStudentSubject.get(`${row.id}:${subject.id}`))}
          {row.subjects[subject.id]?.role === 'fourth' && (column.field === 'total' || totalOnly) && fourthMarker}
        </td>)}</Fragment>)}
      <td className="text-center font-semibold">{row.complete ? `${row.totalObtained}/${row.totalMax}` : '—'}</td>
      {!totalOnly && <><td className="text-center font-semibold">{row.gpa == null ? '—' : row.gpa.toFixed(2)}</td><td className="text-center">{print ? row.grade : <Badge className="px-1.5 py-0 text-[10px]" variant={!row.complete ? 'secondary' : row.grade === 'F' ? 'destructive' : 'default'}>{row.grade}</Badge>}</td></>}
      <td className="text-center font-semibold">{row.position ?? '—'}</td>
    </tr>)}</tbody>
  </Root>
}
