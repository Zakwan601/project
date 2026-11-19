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
    return options.queryKey[0].startsWith('staff-') ? { isPending: true } : { data: [] }
  },
  useQueryClient: () => ({ invalidateQueries() {} }),
}
let details
function load(path) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const context = { exports: {}, require(name) {
    if (name === 'react') return fakeReact
    if (name === '@tanstack/react-query') return detailQueries
    if (name === 'framer-motion') return { motion: new Proxy({}, { get: () => element }) }
    if (name === './StudentDetails') return details
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
function render() {
  nodes = []; queries = []; tabContext = undefined
  visit(React.createElement(StudentsPage))
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
