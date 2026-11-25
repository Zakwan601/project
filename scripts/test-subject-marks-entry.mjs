import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import React from 'react'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const exams = ['business', 'humanities', 'science'].map((group, i) => ({ id: `exam-${group}`, class_id: group,
  exam_group_id: 'group', exam_date: '2026-11-25', status: 'draft', classes: { name: group, class_group: group },
  result_exam_types: { marks_mode: i === 1 ? 'total_only' : 'sectioned' } }))
const subject = { id: 'accounting', subject_id: 'accounting-paper1', exam_id: exams[0].id, paper_group_id: 'accounting-group',
  creative_max: 70, written_max: 30, practical_max: 0, subjects: { name: 'Accounting', code: '253', is_fourth_subject: true },
  result_subject_paper_groups: { name: 'Accounting combined', code: '253' } }
const tutorial = { ...subject, id: 'english', subject_id: 'english-paper1', paper_group_id: null,
  creative_max: 0, written_max: 20, practical_max: 0, subjects: { name: 'English', code: '107', is_fourth_subject: false }, result_subject_paper_groups: null }
const students = ['Ann', 'Ben', 'Cal'].map((name, i) => ({ id: name, first_name: name, last_name: 'Student',
  roll_number: i + 1, admission_number: `2800${i}`, class_group: 'business',
  group_elective_option_id: i === 0 ? 'accounting-option' : 'economics-option', group_fourth_option_id: i === 1 ? 'accounting-option' : null }))
const options = [{ id: 'accounting-option', first_paper_subject_id: 'accounting-paper1', second_paper_subject_id: 'accounting-paper2' }]
const papers = [{ id: 'accounting-group', first_paper_subject_id: 'accounting-paper1', second_paper_subject_id: 'accounting-paper2' }]
let stored = [{ id: 'existing', student_id: 'Ann', exam_subject_id: subject.id, creative_marks: 10, written_marks: 0, practical_marks: null, is_absent: false }]
let roleCanWrite = true, failSave = false, frames = new Map(), frame, cursor, nodes, queries, active, effects
let nextTimer = 0
const timers = new Map(), pending = [], writes = [], invalidations = [], errors = []
const adapter = props => React.createElement('adapter', props, props.children)
const ui = new Proxy({}, { get: () => adapter })
const dataFor = key => {
  switch (key[0]) {
    case 'marks-entry-exams': return exams
    case 'result-exam-subjects': return key[1] === exams[0].id ? [subject] : key[1] === exams[1].id ? [tutorial] : []
    case 'result-roster': return key[1] === 'business' ? students : [{ ...students[0], id: 'Other', first_name: 'Other', class_group: 'humanities' }]
    case 'result-roster-curriculum': return key[1] === exams[0].id ? students : [{ ...students[0], id: 'Other', class_group: 'humanities' }]
    case 'result-subject-course-options': return options
    case 'result-subject-paper-groups': return papers
    case 'result-subject-marks': return stored.filter(mark => mark.exam_subject_id === key[2])
  }
}
const fakeReact = { ...React,
  useState(initial) {
    const cell = frame.cells[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value }]
  },
  useRef(initial) { return frame.cells[cursor++] ??= { current: initial } },
  useEffect(fn, deps) {
    const index = cursor++, previous = frame.cells[index], owner = frame
    if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps[i]))) effects.push(() => {
      previous?.cleanup?.(); owner.cells[index] = { deps, cleanup: fn() }
    })
  },
}
const queryHooks = {
  useQuery(options) { queries.push(options); const data = dataFor(options.queryKey); return { data, isPending: data === undefined, error: null } },
  useQueryClient: () => ({ invalidateQueries: options => { invalidations.push(options.queryKey); return Promise.resolve() } }),
  useMutation(options) { return { mutate(value) {
    pending.push(Promise.resolve().then(() => options.mutationFn(value)).then(result => options.onSuccess?.(result), error => options.onError?.(error)))
  } } },
}
const db = { from(table) { assert.equal(table, 'result_marks'); return { async upsert(row, config) {
  assert.equal(config.onConflict, 'exam_subject_id,student_id')
  if (failSave) throw Error('Simulated save failure')
  writes.push({ ...row }); stored = [...stored.filter(item => item.student_id !== row.student_id || item.exam_subject_id !== row.exam_subject_id), { ...row, id: 'saved' }]
  return { error: null }
} } } }
function load(path) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const context = { exports: {}, setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id }, clearTimeout(id) { timers.delete(id) }, require(name) {
    if (name === 'react') return fakeReact
    if (name === '@tanstack/react-query') return queryHooks
    if (name === '@/lib/supabase') return { supabase: db }
    if (name === '@/contexts/AuthContext') return { useAuth: () => ({ user: { id: 'teacher' }, can: () => roleCanWrite }) }
    if (name === '@/hooks/useClasses') return { useClasses: () => ({ data: [{ id: 'business' }, { id: 'humanities' }] }) }
    if (name === './result-model') return load('../src/features/results/result-model.ts')
    if (name === './ResultControls') return { MarkInput: props => React.createElement('mark-input', props) }
    if (name === 'sonner') return { toast: { error: error => errors.push(error) } }
    if (name.startsWith('@/')) return ui
    return require(name)
  } }
  vm.runInNewContext(code, context)
  return context.exports
}
const { SubjectMarksEntry, subjectMarkValues } = load('../src/features/results/SubjectMarksEntry.tsx')
function visit(node, path = 'root') {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((child, i) => visit(child, `${path}/${child?.key ?? i}`)); return }
  if (typeof node.type === 'function') {
    const id = `${path}:${node.type.name}`
    active.add(id)
    frame = frames.get(id) ?? { cells: [] }; frames.set(id, frame); cursor = 0
    visit(node.type(node.props), `${id}/child`)
  } else { nodes.push(node); visit(node.props?.children, `${path}/children`) }
}
function render() {
  nodes = []; queries = []; active = new Set(); effects = []
  visit(React.createElement(SubjectMarksEntry, { exam: exams[0] }))
  for (const [id, old] of frames) if (!active.has(id)) { old.cells.forEach(cell => cell?.cleanup?.()); frames.delete(id) }
  effects.forEach(fn => fn())
}
function select(id, value) {
  // Select and trigger are separate UI nodes; change the Select wrapping the trigger.
  const trigger = nodes.find(node => node.props.id === id)
  assert.ok(trigger, `Missing selector ${id}`)
  const parent = nodes.find(node => node.props.onValueChange && node.props.children?.some?.(child => child?.props?.id === id))
  assert.ok(parent); parent.props.onValueChange(value); render()
}
function input(name, component) { return nodes.find(node => node.type === 'mark-input' && node.props.label === `${name} Student ${component} marks`) }
async function settle() { while (pending.length) await Promise.all(pending.splice(0)) }
async function tick() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); await settle(); render() }

render()
assert.ok(!queries.find(query => query.queryKey[0] === 'result-subject-marks').enabled, 'Do not fetch marks before choosing a subject')
assert.ok(!nodes.some(node => node.props.value === 'science'), 'Teacher cannot select a class outside the authorized class list')
select('marks-subject', subject.id); render()
assert.ok(input('Ann', 'creative')); assert.ok(input('Ben', 'creative'))
assert.ok(!input('Cal', 'creative'), 'Exclude students who do not take the elective')
assert.equal(input('Ann', 'MCQ').props.value, '0', 'An existing zero remains recorded')
assert.equal(input('Ben', 'MCQ').props.value, '', 'Missing marks remain blank')
assert.ok(nodes.some(node => String(node.props.children).includes('Fourth subject')), 'Fourth subject students stay in the subject list')
input('Ann', 'creative').props.onChange('15'); render()
input('Ben', 'creative').props.onChange('25'); render()
await tick()
assert.equal(writes.length, 2, 'Separate rows each save without cancelling another row')
assert.equal(writes.find(row => row.student_id === 'Ann').creative_marks, 15)
assert.equal(writes.find(row => row.student_id === 'Ann').written_marks, 0)
assert.equal(writes.find(row => row.student_id === 'Ben').written_marks, null)
assert.ok(writes.every(row => row.exam_subject_id === subject.id && row.entered_by === 'teacher'))
assert.ok(invalidations.some(key => key[0] === 'result-preview'))

nodes.find(node => node.props['aria-label'] === 'Mark Ben Student as absent').props.onCheckedChange(true); render(); await tick()
assert.equal(writes.at(-1).is_absent, true); assert.equal(writes.at(-1).creative_marks, null)
assert.equal(input('Ben', 'creative').props.disabled, true)

failSave = true; input('Ann', 'creative').props.onChange('18'); render(); await tick()
assert.ok(nodes.some(node => node.props.children === 'Retry save'))
failSave = false; nodes.find(node => node.props.children === 'Retry save').props.onClick(); await settle(); render()
assert.equal(writes.at(-1).creative_marks, 18)

input('Ann', 'creative').props.onChange('20'); render()
select('marks-class', 'humanities'); await settle(); render()
assert.equal(writes.at(-1).student_id, 'Ann', 'Switching class flushes pending edits to the original student')
assert.equal(writes.at(-1).exam_subject_id, subject.id)
assert.equal(writes.at(-1).creative_marks, 20)
assert.ok(!nodes.some(node => node.type === 'mark-input'), 'Changing class clears subject selection and old students')
select('marks-subject', tutorial.id); render()
assert.ok(input('Other', 'total')); assert.ok(!input('Other', 'creative'), 'Tutorial exams show only total marks')
input('Other', 'total').props.onChange('17'); render(); await tick()
assert.equal(writes.at(-1).exam_subject_id, tutorial.id)
assert.equal(writes.at(-1).written_marks, 17)
assert.equal(writes.at(-1).creative_marks, null)
exams[1].status = 'published'; render()
assert.equal(input('Other', 'total').props.disabled, true, 'Published marks are read-only')
const count = writes.length; input('Other', 'total').props.onChange('19'); await tick(); assert.equal(writes.length, count)
exams[1].status = 'draft'; roleCanWrite = false; render()
assert.equal(input('Other', 'total').props.disabled, true, 'Write permission remains required')

assert.throws(() => subjectMarkValues(subject, { creative: '71', written: '', practical: '', absent: false }), /between 0 and 70/)
assert.throws(() => subjectMarkValues(subject, { creative: '-1', written: '', practical: '', absent: false }), /between/)
assert.equal(subjectMarkValues(subject, { creative: '', written: '0', practical: '', absent: false }).written_marks, 0)
assert.equal(subjectMarkValues(subject, { creative: '', written: '', practical: '', absent: false }).written_marks, null)
// Revised tutorial type retains distinct CQ/MCQ inputs and no practical column.
exams[1].result_exam_types.marks_mode = 'total_pass'
Object.assign(tutorial, { creative_max: 10, written_max: 10, pass_mark: 6.6 })
stored = []; frames = new Map(); roleCanWrite = true; render()
select('marks-class', 'humanities'); select('marks-subject', tutorial.id); render()
assert.ok(input('Other', 'CQ')); assert.ok(input('Other', 'MCQ'))
assert.ok(!input('Other', 'total') && !input('Other', 'practical'))
assert.equal(input('Other', 'CQ').props.max, 10); assert.equal(input('Other', 'MCQ').props.max, 10)
assert.ok(nodes.some(node => String(node.props.children).includes('No separate CQ or MCQ pass marks')))
input('Other', 'CQ').props.onChange('0'); render()
input('Other', 'MCQ').props.onChange('6.6'); render(); await tick()
assert.equal(writes.at(-1).creative_marks, 0); assert.equal(writes.at(-1).written_marks, 6.6)
assert.equal(writes.at(-1).practical_marks, null)
console.log('Passed subject-first marks UI: class isolation, elective/fourth eligibility, existing zeros, independent autosaves, pending edits on class changes, retry, absence, tutorial totals and published/permission locks.')
