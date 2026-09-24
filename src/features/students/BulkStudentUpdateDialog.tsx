import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { supabase } from '@/lib/supabase'
import { isValidBangladeshMobile, normalizeBangladeshMobile } from '@/lib/profile'
import type { BloodGroup, ClassWithDetails, Student, StudentWithClass } from '@/types/database'

// Database types are maintained manually in this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const
const CLEAR_VALUE = '[CLEAR]'
const columns = [
  ['Admission Number', 22], ['First Name', 20], ['Last Name', 20], ['Roll Number', 14],
  ['Guardian Phone', 20], ['Secondary Mobile', 20], ["Father's Name", 24], ["Mother's Name", 24],
  ['Blood Group', 14], ['Biometric ID', 18], ['Class ID', 40], ['Class Reference (read only)', 34],
] as const

type EditableKey = 'first_name' | 'last_name' | 'roll_number' | 'guardian_phone' | 'secondary_phone' |
  'father_name' | 'mother_name' | 'blood_group' | 'biometric_id' | 'class_id'
interface ParsedUpdate {
  rowNumber: number
  student: StudentWithClass
  updates: Partial<Student>
  changes: string[]
  errors: string[]
}
interface CompletionResult { rowNumber: number; admissionNumber: string; error?: string }
interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  students: StudentWithClass[]
  classes: ClassWithDetails[]
  scopeLabel: string
  onComplete: () => Promise<void> | void
}

function textValue(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'object') {
    if ('result' in value && value.result != null) return String(value.result).trim()
    if ('text' in value && value.text != null) return String(value.text).trim()
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map(part => String(part.text ?? '')).join('').trim()
    }
  }
  return String(value).trim()
}
function spreadsheetPhone(value: string) {
  const compact = value.replace(/[\s()-]/g, '')
  return /^1[3-9]\d{8}$/.test(compact) ? `0${compact}` : value
}
function classReference(student: StudentWithClass) {
  const value = student.classes
  return value ? `${value.name} (${value.grade}-${value.section})` : ''
}
function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'students'
}

export function BulkStudentUpdateDialog({ open, onOpenChange, students, classes, scopeLabel, onComplete }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<ParsedUpdate[]>([])
  const [fileErrors, setFileErrors] = useState<string[]>([])
  const [isReading, setIsReading] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [results, setResults] = useState<CompletionResult[]>([])
  const invalidRows = rows.filter(row => row.errors.length)
  const validRows = rows.filter(row => !row.errors.length && row.changes.length)
  const unchangedRows = rows.filter(row => !row.errors.length && !row.changes.length)
  const canApply = !fileErrors.length && !invalidRows.length && validRows.length > 0 && !isApplying

  const resetImport = () => {
    setFileName(''); setRows([]); setFileErrors([]); setResults([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }
  const changeOpen = (next: boolean) => {
    if (isApplying) return
    if (!next) resetImport()
    onOpenChange(next)
  }

  const downloadTemplate = async () => {
    if (!students.length) return toast.error('There are no students in the current list.')
    setIsDownloading(true)
    try {
      const ExcelJS = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      workbook.creator = 'Axentra Attendance'
      const sheet = workbook.addWorksheet('Students', { views: [{ state: 'frozen', ySplit: 1 }] })
      sheet.columns = columns.map(([header, width]) => ({ header, width }))
      students.forEach(student => sheet.addRow([
        student.admission_number, student.first_name, student.last_name, student.roll_number,
        student.guardian_phone, student.secondary_phone, student.father_name, student.mother_name,
        student.blood_group, student.biometric_id, student.class_id, classReference(student),
      ]))
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } }
      sheet.autoFilter = { from: 'A1', to: 'L1' }
      ;[1, 5, 6, 10, 11].forEach(index => { sheet.getColumn(index).numFmt = '@' })
      for (let row = 2; row <= Math.max(sheet.rowCount, 500); row += 1) {
        sheet.getCell(`I${row}`).dataValidation = {
          type: 'list', allowBlank: true, formulae: [`"${BLOOD_GROUPS.join(',')}"`],
          showErrorMessage: true, errorTitle: 'Invalid blood group', error: 'Choose a value from the dropdown.',
        }
      }
      const classSheet = workbook.addWorksheet('Classes', { views: [{ state: 'frozen', ySplit: 1 }] })
      classSheet.columns = [
        { header: 'Class ID', width: 40 }, { header: 'Name', width: 24 }, { header: 'Grade', width: 14 },
        { header: 'Section', width: 14 }, { header: 'Group', width: 18 }, { header: 'Academic Session', width: 22 },
      ]
      classes.forEach(value => classSheet.addRow([
        value.id, value.name, value.grade, value.section, value.class_group, value.academic_years?.name ?? '',
      ]))
      classSheet.getRow(1).font = { bold: true }
      const instructions = workbook.addWorksheet('Instructions')
      instructions.getColumn(1).width = 110
      ;[
        'Edit only the Students sheet and keep all headers unchanged.',
        'Admission Number is required and identifies the existing student. Do not change it.',
        'Blank cells leave database values unchanged.',
        `Enter ${CLEAR_VALUE} to remove an optional value.`,
        'Use a Class ID from the Classes sheet. Class Reference is informational only.',
        `Allowed blood groups: ${BLOOD_GROUPS.join(', ')}.`,
        'The import is blocked until every populated row passes validation.',
      ].forEach(value => instructions.addRow([value]))
      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = `student-bulk-update-${safeFilename(scopeLabel)}.xlsx`; link.click()
      URL.revokeObjectURL(url)
    } catch (error) { toast.error((error as Error).message || 'Could not create the Excel template.') }
    finally { setIsDownloading(false) }
  }

  const parseFile = async (file: File) => {
    resetImport(); setFileName(file.name); setIsReading(true)
    try {
      const ExcelJS = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await file.arrayBuffer())
      const sheet = workbook.getWorksheet('Students') ?? workbook.worksheets[0]
      if (!sheet) throw new Error('The workbook does not contain a worksheet.')
      const headers = new Map<string, number>()
      sheet.getRow(1).eachCell((cell, number) => headers.set(textValue(cell.value).toLowerCase(), number))
      const admissionColumn = headers.get('admission number')
      if (!admissionColumn) {
        setFileErrors(['Missing required “Admission Number” column. Download a fresh template and keep its headers unchanged.'])
        return
      }
      const byAdmission = new Map(students.map(value => [value.admission_number.trim().toLowerCase(), value]))
      const classById = new Map(classes.map(value => [value.id, value]))
      const seenAdmissions = new Set<string>()
      const seenBiometrics = new Map<string, number>()
      const parsed: ParsedUpdate[] = []
      const cell = (row: number, label: string) => {
        const number = headers.get(label.toLowerCase())
        return number ? textValue(sheet.getRow(row).getCell(number).value) : ''
      }
      for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const hasData = columns.some(([label]) => cell(rowNumber, label) !== '')
        if (!hasData) continue
        const admissionNumber = textValue(sheet.getRow(rowNumber).getCell(admissionColumn).value)
        const key = admissionNumber.toLowerCase()
        const student = byAdmission.get(key)
        const errors: string[] = []
        if (!admissionNumber) errors.push('Admission Number is required.')
        else if (seenAdmissions.has(key)) errors.push('Admission Number is duplicated in this file.')
        else if (!student) errors.push('No student matches this Admission Number in the current list.')
        seenAdmissions.add(key)
        if (!student) {
          parsed.push({ rowNumber, student: { admission_number: admissionNumber, first_name: '', last_name: '' } as StudentWithClass, updates: {}, changes: [], errors })
          continue
        }
        const updates: Partial<Student> = {}
        const changes: string[] = []
        const add = (field: EditableKey, value: unknown, label: string) => {
          const current = student[field]
          const samePhone = (field === 'guardian_phone' || field === 'secondary_phone')
            && typeof current === 'string' && typeof value === 'string'
            && normalizeBangladeshMobile(current) === normalizeBangladeshMobile(value)
          if (!samePhone && (current ?? null) !== (value ?? null)) {
            ;(updates as Record<EditableKey, unknown>)[field] = value
            changes.push(label)
          }
        }
        const firstName = cell(rowNumber, 'First Name')
        if (firstName) firstName.toUpperCase() === CLEAR_VALUE ? errors.push('First Name cannot be cleared.') : add('first_name', firstName, 'first name')
        const lastName = cell(rowNumber, 'Last Name')
        if (lastName) lastName.toUpperCase() === CLEAR_VALUE ? errors.push('Last Name cannot be cleared.') : add('last_name', lastName, 'last name')
        const roll = cell(rowNumber, 'Roll Number')
        if (roll) {
          if (roll.toUpperCase() === CLEAR_VALUE) add('roll_number', null, 'roll number')
          else if (!/^\d+$/.test(roll) || Number(roll) < 1) errors.push('Roll Number must be a positive whole number.')
          else add('roll_number', Number(roll), 'roll number')
        }
        const parsePhone = (label: string, field: 'guardian_phone' | 'secondary_phone') => {
          const raw = cell(rowNumber, label)
          if (!raw) return
          if (raw.toUpperCase() === CLEAR_VALUE) return add(field, null, label.toLowerCase())
          const phone = spreadsheetPhone(raw)
          if (!isValidBangladeshMobile(phone)) errors.push(`${label} is not a valid Bangladesh mobile number.`)
          else add(field, normalizeBangladeshMobile(phone), label.toLowerCase())
        }
        parsePhone('Guardian Phone', 'guardian_phone'); parsePhone('Secondary Mobile', 'secondary_phone')
        const parseText = (label: string, field: 'father_name' | 'mother_name' | 'biometric_id') => {
          const raw = cell(rowNumber, label)
          if (!raw) return
          if (raw.toUpperCase() === CLEAR_VALUE) add(field, null, label.toLowerCase())
          else if (field !== 'biometric_id' && raw.length > 120) errors.push(`${label} must be 120 characters or fewer.`)
          else add(field, raw, label.toLowerCase())
        }
        parseText("Father's Name", 'father_name'); parseText("Mother's Name", 'mother_name'); parseText('Biometric ID', 'biometric_id')
        const blood = cell(rowNumber, 'Blood Group').toUpperCase()
        if (blood) {
          if (blood === CLEAR_VALUE) add('blood_group', null, 'blood group')
          else if (!BLOOD_GROUPS.includes(blood as BloodGroup)) errors.push(`Blood Group must be one of: ${BLOOD_GROUPS.join(', ')}.`)
          else add('blood_group', blood, 'blood group')
        }
        const classId = cell(rowNumber, 'Class ID')
        if (classId) {
          if (classId.toUpperCase() === CLEAR_VALUE) add('class_id', null, 'class')
          else {
            const targetClass = classById.get(classId)
            if (!targetClass) errors.push('Class ID was not found in the current database.')
            else if (targetClass.class_group !== student.class_group) errors.push('A class-group change requires the individual editor so subject choices can be selected.')
            else add('class_id', classId, 'class')
          }
        }
        if (typeof updates.biometric_id === 'string') {
          const biometric = updates.biometric_id.toLowerCase()
          const duplicateRow = seenBiometrics.get(biometric)
          const conflict = students.find(value => value.id !== student.id && value.biometric_id?.trim().toLowerCase() === biometric)
          if (duplicateRow) errors.push(`Biometric ID is also used on row ${duplicateRow}.`)
          else if (conflict) errors.push(`Biometric ID is already assigned to ${conflict.admission_number}.`)
          else seenBiometrics.set(biometric, rowNumber)
        }
        parsed.push({ rowNumber, student, updates, changes, errors })
      }
      if (!parsed.length) setFileErrors(['No populated student rows were found in the workbook.'])
      setRows(parsed)
    } catch (error) { setFileErrors([(error as Error).message || 'The Excel file could not be read.']) }
    finally { setIsReading(false) }
  }

  const applyUpdates = async () => {
    if (!canApply) return
    setIsApplying(true); setResults([])
    const completion: CompletionResult[] = []
    for (const row of validRows) {
      try {
        const { error } = await db.from('students').update(row.updates).eq('id', row.student.id)
        if (error) throw error
        
        completion.push({ rowNumber: row.rowNumber, admissionNumber: row.student.admission_number })
      } catch (error) {
        completion.push({ rowNumber: row.rowNumber, admissionNumber: row.student.admission_number, error: (error as Error).message || 'Update failed.' })
      }
    }
    setResults(completion); setIsApplying(false)
    const failed = completion.filter(value => value.error).length
    const succeeded = completion.length - failed
    if (succeeded) await onComplete()
    failed ? toast.warning(`${succeeded} updated, ${failed} failed.`) : toast.success(`${succeeded} student profile${succeeded === 1 ? '' : 's'} updated.`)
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
      <DialogHeader><DialogTitle>Bulk edit student profiles</DialogTitle><DialogDescription>
        Download the template for {scopeLabel}, edit it in Excel, then upload it for validation and review.
      </DialogDescription></DialogHeader>
      <div className="grid min-h-0 gap-4">
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <div className="space-y-2"><p className="text-sm font-medium">1. Download template</p>
            <p className="text-xs text-muted-foreground">Includes {students.length} students and a Classes reference sheet.</p>
            <Button type="button" variant="outline" onClick={downloadTemplate} disabled={isDownloading || !students.length}>
              {isDownloading ? <Loader2 className="animate-spin" /> : <Download />} Download Excel template
            </Button>
          </div>
          <div className="space-y-2"><Label htmlFor="student-bulk-file">2. Upload completed file</Label>
            <Input ref={fileInputRef} id="student-bulk-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={isReading || isApplying} onChange={event => { const file = event.target.files?.[0]; if (file) void parseFile(file) }} />
            <p className="text-xs text-muted-foreground">Blank cells keep current values. Use {CLEAR_VALUE} to remove an optional value.</p>
          </div>
        </div>
        {(isReading || fileName) && <div className="flex flex-wrap items-center gap-2 text-sm">
          {isReading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          <span className="max-w-full truncate font-medium">{fileName}</span>
          {!isReading && <><Badge variant="secondary">{validRows.length} to update</Badge>
            {!!unchangedRows.length && <Badge variant="outline">{unchangedRows.length} unchanged</Badge>}
            {!!invalidRows.length && <Badge variant="destructive">{invalidRows.length} invalid</Badge>}</>}
        </div>}
        {fileErrors.map(message => <div key={message} className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{message}
        </div>)}
        {!isReading && !!rows.length && <ScrollArea className="max-h-[38vh] rounded-md border"><Table>
          <TableHeader><TableRow><TableHead className="w-16">Row</TableHead><TableHead>Student</TableHead><TableHead>Review</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map(row => <TableRow key={`${row.rowNumber}-${row.student.admission_number}`}>
            <TableCell>{row.rowNumber}</TableCell><TableCell><p className="font-medium">{row.student.admission_number || 'Unknown'}</p>
              <p className="text-xs text-muted-foreground">{`${row.student.first_name} ${row.student.last_name}`.trim()}</p></TableCell>
            <TableCell>{row.errors.length ? <ul className="space-y-1 text-xs text-destructive">{row.errors.map(message => <li key={message}>{message}</li>)}</ul>
              : row.changes.length ? <p className="text-xs">Change: {row.changes.join(', ')}</p> : <p className="text-xs text-muted-foreground">No changes</p>}</TableCell>
          </TableRow>)}</TableBody>
        </Table></ScrollArea>}
        {!!results.length && <div className="rounded-md border p-3"><p className="mb-2 text-sm font-medium">Completion report</p>
          <div className="max-h-40 space-y-1 overflow-y-auto text-xs">{results.map(result => <div key={result.rowNumber} className="flex items-start gap-2">
            {result.error ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />}
            <span>Row {result.rowNumber} · {result.admissionNumber} · {result.error ?? 'Updated successfully'}</span>
          </div>)}</div>
        </div>}
      </div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={isApplying}>Close</Button>
        <Button type="button" onClick={applyUpdates} disabled={!canApply}>{isApplying ? <Loader2 className="animate-spin" /> : <Upload />}
          {isApplying ? 'Applying updates...' : `Apply ${validRows.length} update${validRows.length === 1 ? '' : 's'}`}
        </Button></DialogFooter>
    </DialogContent>
  </Dialog>
}