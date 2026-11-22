import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import React from 'react'
import ts from 'typescript'

// Exercise the actual page/component tree with hook and UI adapters. Queries
// remain pending so this verifies when each detail request can first be started.
const require = createRequire(import.meta.url)
const student = { id: 'student-a', first_name: 'Example', last_name: 'Student', admission_number: '28001',
  class_id: 'science', class_group: 'science', is_active: true, classes: { name: 'Science', id: 'science' } }
const secondStudent = { ...student, id: 'student-b', first_name: 'Another', class_id: 'business' }
let grants = new Set(['students:read', 'students:write', 'reports:read', 'results:read'])
let role = 'sub_admin'
let frames = new Map(), currentFrame, cursor, nodes, queries, tabContext
let formValues = {}
let printedSources = []
const queryData = new Map()
const fakeReact = { ...React, useEffect() {}, useRef: initial => ({ current: initial }), useState(initial) {
  const frame = currentFrame
  const index = cursor++
  if (!(index in frame)) frame[index] = typeof initial === 'function' ? initial() : initial
  return [frame[index], value => { frame[index] = typeof value === 'function' ? value(frame[index]) : value }]
} }
const element = (props = {}) => React.createElement('adapter', props, props.children)
const ui = new Proxy({}, { get: (_, name) => {
  if (name === 'Dialog' || name === 'AlertDialog') return props => props.open ? element(props) : null
  if (name === 'Tabs') return props => { tabContext = props; return element(props) }
  if (name === 'TabsContent') return props => props.value === tabContext.value ? element(props) : null
  if (name === 'TabsTrigger') return props => element({ ...props, onClick: () => tabContext.onValueChange(props.value) })
  return element
} })
const detailQueries = {
  useQuery(options) {
    queries.push(options)
    if (queryData.has(options.queryKey[0])) return { data: queryData.get(options.queryKey[0]), isPending: false }
    return options.queryKey[0].startsWith('staff-') || options.queryKey[0] === 'fine-account' ? { isPending: true } : { data: [] }
  },
  useQueryClient: () => ({ invalidateQueries() {} }),
  useMutation: () => ({ isPending: false, mutate() {} }),
}
let details
function load(path) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const context = { exports: {}, crypto: globalThis.crypto, require(name) {
    if (name === 'react') return fakeReact
    if (name === '@tanstack/react-query') return detailQueries
    if (name === 'framer-motion') return { motion: new Proxy({}, { get: () => element }) }
    if (name === './StudentDetails') return details
    if (name === 'react-router-dom') return { Link: element, Navigate: props => element({ ...props, 'data-navigation': true }) }
    if (name === './FinePaymentHistory') return { FINE_ACCOUNTS_KEY: 'fine-account', FineStatus: element, PaymentReceipts: element,
      useFineAccount: (id, until) => detailQueries.useQuery({ queryKey: ['fine-account', id, until] }) }
    if (name === './FineReceipts') return load('../src/features/fines/FineReceipts.tsx')
    if (name === '@/lib/dateTime') return load('../src/lib/dateTime.ts')
    if (name === '@/lib/attendanceFine') return load('../src/lib/attendanceFine.ts')
    if (name === '@/lib/printReportCard') return { printReportCards: sources => { printedSources = sources } }
    if (name === '@/contexts/AuthContext') return { useAuth: () => ({ role, can: (key, access = 'read') => role === 'admin' || grants.has(`${key}:${access}`) }) }
    if (name === '@/hooks/useStudents') return new Proxy({ STUDENTS_KEY: 'students', useStudents: () => ({ data: [student, secondStudent] }) },
      { get: (target, key) => target[key] ?? (() => ({})) })
    if (name === '@/hooks/useClasses') return { useClasses: () => ({ data: [] }) }
    if (name === 'react-hook-form') return { useForm: () => ({ register: () => ({}), handleSubmit: fn => fn,
      reset: values => { formValues = values }, setValue: (key, value) => { formValues[key] = value },
      watch: key => Array.isArray(key) ? key.map(field => formValues[field]) : formValues[key], formState: { errors: {} } }) }
    if (name === '@/lib/profile') return { getStudentProfileMissingRequirements: () => [], isValidBangladeshMobile: () => true }
    if (name.startsWith('@/') || name.startsWith('./')) return ui
    return require(name)
  } }
  vm.runInNewContext(code.replaceAll('import.meta.env', '({})'), context)
  return context.exports
}
details = load('../src/features/students/StudentDetails.tsx')
const { StudentsPage } = load('../src/features/students/StudentsPage.tsx')
function visit(node) {
  if (node == null || typeof node === 'boolean') return
  if (Array.isArray(node)) { node.forEach(visit); return }
  if (typeof node !== 'object') return
  if (typeof node.type === 'function') {
    const saved = [currentFrame, cursor]
    if (!frames.has(node.type)) frames.set(node.type, [])
    currentFrame = frames.get(node.type); cursor = 0
    const rendered = node.type(node.props)
    ;[currentFrame, cursor] = saved
    visit(rendered)
  } else {
    if (node.props?.ref && typeof node.props.ref === 'object') node.props.ref.current = node
    nodes.push(node); visit(node.props?.children)
  }
}
let rootComponent = StudentsPage
function render() {
  nodes = []; queries = []; tabContext = undefined
  visit(React.createElement(rootComponent))
  return queries.filter(query => query.queryKey[0].startsWith('staff-') && query.enabled !== false)
}
function click(label) {
  const button = nodes.find(node => node.props['aria-label'] === label || node.props.children === label)
  assert.ok(button?.props.onClick, `Missing action: ${label}`)
  button.props.onClick()
}
assert.equal(render().length, 0, 'Student list must not request attendance, fine or result data')
click('Student details for Example Student')
assert.equal(render().length, 0, 'Opening Overview must not request unopened detail tabs')
click('Attendance & fines')
assert.deepEqual(render().map(query => Array.from(query.queryKey)), [['staff-student-attendance-report', 'student-a']])
assert.ok(!nodes.some(node => node.props.children === 'Fines'), 'Separate fine tab must be removed')
const fine = { recordedAbsences: 1, lateDays: 0, finePerAbsentDay: 50, attendanceFine: 50,
  examMissedCount: 0, examMissedFineAmount: 100, examMissedFine: 0, totalFine: 50 }
const attendance = { stats: { attendanceRate: 95, presentCount: 17, absentCount: 1, lateCount: 2, excusedCount: 0 },
  subjects: [], months: [{ month: '2026-11-01', present: 17, absent: 1, late: 2, excused: 0, total: 20, percentage: 95 }] }
queryData.set('staff-student-attendance-report', { attendance, exceptions: { missedExams: [{ id: 'missed-1', date: '2026-10-05', exam: 'Tutorial Exam - 1', subject: 'Bangla' }] }, fines: { total: fine,
  months: [{ ...fine, month: '2026-11-01', presentDays: 17 }, { ...fine, month: '2026-10-01', presentDays: 0, examMissedCount: 1 }] } })
render()
assert.ok(nodes.some(node => node.props.children === 'Monthly attendance & fines'))
assert.ok(nodes.some(node => node.props.children === 'Nov 2026'), 'Available months must render in the fine table')
assert.equal(nodes.filter(node => node.props.children === 'Nov 2026').length, 1, 'Attendance and fine months must share one row')
assert.ok(nodes.some(node => node.props.children === 'Oct 2026'), 'Exam-only fine months must not be lost when joining attendance')
assert.ok(nodes.some(node => node.props.children === 17), 'Monthly present days must appear in the report')
assert.ok(nodes.some(node => node.props.children === 'Missed exam details'))
assert.ok(nodes.some(node => node.props.children === '05 Oct 2026'))
assert.ok(nodes.some(node => node.props.children === 'Tutorial Exam - 1'))
assert.ok(nodes.some(node => node.props.children === 'Bangla'))
const printButton = nodes.find(node => node.props.onClick && Array.isArray(node.props.children) && node.props.children.includes('Print guardian report'))
assert.ok(printButton, 'Guardian report print action must be available after data loads')
printButton.props.onClick()
assert.equal(printedSources.length, 1)
assert.ok(printedSources[0].props.className.includes('student-guardian-report'), 'Print only the student report, not the list or modal controls')
assert.ok(nodes.some(node => node.props.children === 'Attendance & Fine Report'))
assert.ok(nodes.some(node => node.props.children === 'Attendance overview'), 'Print source includes the attendance summary')
queryData.set('staff-student-attendance-report', { attendance: { stats: attendance.stats, subjects: [], months: [] }, exceptions: { missedExams: [] }, fines: { total: fine, months: [] } })
render()
assert.ok(nodes.some(node => node.props.children === 'No monthly records available.'))
assert.ok(nodes.some(node => node.props.children === 'No missed exams recorded.'))
click('Results')
assert.deepEqual(render().map(query => Array.from(query.queryKey)), [['staff-student-exams', 'student-a', 'science']])
click('Overview')
assert.equal(render().length, 0, 'Leaving detail tabs removes their active query observers')
assert.ok(!nodes.some(node => node.props.children === 'Account'), 'Sub-admin student write permission must not expose Account')
role = 'admin'
render()
click('Account')
assert.equal(render().length, 0, 'Account actions must not start attendance or result requests')
assert.ok(nodes.some(node => Array.isArray(node.props.children) && node.props.children.includes('Delete student') && node.props.onClick),
  'Full admin can delete inside Account')
assert.ok(nodes.some(node => Array.isArray(node.props.children) && node.props.children.includes('Set Up Student Login')), 'Full admin can set up student logins')
role = 'sub_admin'
grants = new Set(['students:read'])
assert.equal(render().length, 0)
for (const label of ['Edit info', 'Attendance & fines', 'Results', 'Account'])
  assert.ok(!nodes.some(node => node.props.children === label), `Read-only student permission must not expose ${label}`)
grants = new Set(['students:read', 'reports:read', 'results:read'])
render(); click('Results')
queryData.set('staff-student-exams', [{ id: 'exam-1', title: 'Tutorial', status: 'draft', classes: { name: 'Science' } }])
const subject = { id: 'bangla', name: 'Bangla', creative_max: 0, written_max: 20, practical_max: 0,
  creative_marks: null, written_marks: null, practical_marks: null, is_absent: false, obtained: 0, total_max: 20 }
const result = { exam: { marks_mode: 'total_only' }, subjects: [subject],
  summary: { total_obtained: 0, total_max: 20, gpa: null, letter_grade: null, position: null } }
queryData.set('staff-student-result', result)
assert.deepEqual(render().map(query => Array.from(query.queryKey)), [
  ['staff-student-exams', 'student-a', 'science'], ['staff-student-result', 'student-a', 'exam-1'],
])
assert.ok(nodes.some(node => node.props.children === 'Pending'), 'Missing marks must be pending rather than fabricated zero results')
result.subjects = [{ ...subject, written_marks: 0 }]
render()
assert.ok(nodes.some(node => node.props.children === '0/20'), 'A recorded zero is a real mark')
assert.ok(!nodes.some(node => node.props.children === 'GPA'), 'Tutorial results must not expose GPA')
nodes.find(node => node.props.open === true && node.props.onOpenChange)?.props.onOpenChange(false)
assert.equal(render().length, 0, 'Closing student details must leave no active detail requests')
click('Student details for Another Student')
assert.equal(render().length, 0, 'Opening a different student resets to Overview')
click('Attendance & fines')
assert.deepEqual(render().map(query => Array.from(query.queryKey)), [['staff-student-attendance-report', 'student-b']])
console.log('Passed actual student-list/detail rendering: lazy tab loading, permission gates, closed-dialog behavior, student isolation, pending marks and zero-mark tutorial results.')

// Fine collection has its own full-admin gate, and loads no account data in the list.
rootComponent = load('../src/features/fines/FineCollectionPage.tsx').FineCollectionPage
role = 'sub_admin'; render()
assert.ok(nodes.some(node => node.props['data-navigation']), 'Sub-admins must be redirected away from fine collection')
assert.ok(!queries.some(query => query.queryKey[0] === 'fine-account'))
role = 'admin'; render()
assert.ok(!queries.some(query => query.queryKey[0] === 'fine-account'), 'Fine collection list must not load per-student financial details')
queryData.set('fine-collection-totals', { received: 1234, waived: 100, assessed: 1334, receipts: 3 })
render()
assert.ok(nodes.some(node => node.props.children === '\u09f31,234.00'), 'Collection header shows net receipts, not assessed fines')
nodes.find(node => node.props.id === 'collection-from').props.onChange({ target: { value: '2026-11-01' } })
nodes.find(node => node.props.id === 'collection-to').props.onChange({ target: { value: '2026-11-22' } })
render()
assert.deepEqual(Array.from(queries.find(query => query.queryKey[0] === 'fine-collection-totals').queryKey), ['fine-collection-totals', '2026-11-01', '2026-11-22'])
nodes.find(node => node.props.id === 'collection-from').props.onChange({ target: { value: '2026-11-23' } })
render()
assert.equal(queries.find(query => query.queryKey[0] === 'fine-collection-totals').enabled, false, 'Invalid date ranges must not query totals')
click('All time'); render()
assert.deepEqual(Array.from(queries.find(query => query.queryKey[0] === 'fine-collection-totals').queryKey), ['fine-collection-totals', '', ''])
nodes.find(node => node.props['aria-label'] === 'Collect fine for Example Student').props.onClick({ stopPropagation() {} })
render()
assert.ok(queries.some(query => query.queryKey[0] === 'fine-account' && query.queryKey[1] === 'student-a'))
const financialAccount = { student_id: 'student-a', paid_through: null, next_start: '2026-11-01',
  quote: { from_date: '2026-11-01', to_date: '2026-11-20', gross_amount: 100, eligible: true, fine: null }, months: [], payments: [] }
queryData.set('fine-account', financialAccount)
render()
nodes.find(node => node.props.id === 'fine-waiver').props.onChange({ target: { value: '20' } })
render()
assert.ok(nodes.some(node => node.props.children === '\u09f380.00'), 'Waiver is deducted from the amount to receive')
assert.ok(nodes.some(node => node.props.children === 'Mark paid' && !node.props.disabled))
nodes.find(node => node.props.id === 'fine-waiver').props.onChange({ target: { value: '101' } })
render()
assert.ok(nodes.some(node => node.props.children === 'Mark paid' && node.props.disabled), 'Excess waivers must disable collection')
financialAccount.quote.eligible = false
nodes.find(node => node.props.id === 'fine-waiver').props.onChange({ target: { value: '0' } })
render()
assert.ok(nodes.some(node => node.props.children === 'Mark paid' && node.props.disabled), 'An already-paid date must not be collectible')
// Render the actual two-copy receipt, then use its print action.
const { FineReceiptButton } = load('../src/features/fines/FineReceipts.tsx')
const receipt = { id: 'paid-1', receipt_number: 7, gross_amount: 100, waiver_amount: 20, paid_amount: 80,
  period_start: '2026-11-01', period_end: '2026-11-20', collected_at: '2026-11-20T04:00:00Z', collector_name: 'Collector Example',
  student_snapshot: { name: 'Example Student', student_id: '28001', class_name: 'Science', student_phone: '01712345678' } }
nodes = []; visit(React.createElement(FineReceiptButton, { payment: receipt }))
assert.equal(nodes.filter(node => node.props.className === 'fine-receipt-copy').length, 2)
assert.equal(nodes.filter(node => node.props.children === 'Internal Money Receipt').length, 2, 'Both receipt copies include the small internal receipt heading')
for (const text of ['Student copy', 'Office copy', 'Collector Example', '28001', '01712345678'])
  assert.ok(nodes.some(node => node.props.children === text), `Receipt missing ${text}`)
nodes.find(node => node.props['aria-label'] === 'Print receipt FC-000007').props.onClick()
assert.equal(printedSources[0].props.className, 'fine-receipt-page')
console.log('Passed admin-only collection, lazy financial loading, net/waiver controls, paid-date gating and printable two-copy receipt details.')

const { ClassRoutinePage } = load('../src/features/routines/ClassRoutinePage.tsx')
rootComponent = () => React.createElement(ClassRoutinePage, { publicView: true })
queryData.set('class-routines', { classes: [{ id: 'science', name: 'Science', session: '2026–2027' }], entries: [
  { id: 'period-1', class_id: 'science', day_of_week: 0, start_time: '08:30:00', end_time: '09:15:00', subject_name: 'Bangla / English', teacher_name: 'Example teacher', room: '1' },
] })
role = null; render()
assert.ok(nodes.some(node => node.props.children === 'Bangla / English'), 'Routine is readable before login')
assert.ok(nodes.some(node => node.props.children === 'Sign in'))
assert.ok(!nodes.some(node => node.props['aria-label']?.startsWith('Edit ')), 'Visitors cannot edit routines')
role = 'sub_admin'; render()
assert.ok(!nodes.some(node => node.props['aria-label']?.startsWith('Delete ')), 'Sub-admins cannot remove routines')
role = 'admin'; render()
click('Edit Bangla / English on Sunday'); render()
assert.ok(nodes.some(node => node.props.children === 'Edit period'))
nodes.find(node => node.props.id === 'routine-end').props.onChange({ target: { value: '08:00' } })
render()
assert.ok(nodes.some(node => node.props.children === 'Save period' && node.props.disabled), 'Invalid period times cannot be saved')
nodes.find(node => node.props.id === 'routine-end').props.onChange({ target: { value: '09:15' } })
render()
assert.ok(nodes.some(node => node.props.children === 'Save period' && !node.props.disabled))
console.log('Passed collection total filters, internal receipt labels, public class routine visibility and admin-only routine controls.')
