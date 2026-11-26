import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/features/results/result-model.ts', import.meta.url), 'utf8')
const modelCode = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const model = await import(`data:text/javascript;base64,${Buffer.from(modelCode).toString('base64')}`)
const componentCode = ts.transpileModule(readFileSync(new URL('../src/features/results/ExamResultsTable.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const context = { exports: {}, require: name => {
  if (name === './result-model') return model
  if (name === '@/components/ui/table') return { Table: props => React.createElement('table', props) }
  if (name === '@/components/ui/badge') return { Badge: ({ variant, ...props }) => React.createElement('span', props) }
  return require(name)
} }
vm.runInNewContext(componentCode, context)
const subjects = model.orderResultSubjects([
  ['Social Work', '271+272'], ['English', '107+108'], ['Home Science', '273+274'], ['Bangla', '101+102'],
  ['ICT', '275'], ['Civics & Good Governance', '269+270'], ['Economics', '109+110'],
  ['Islamic History & Culture', '267+268'], ['Islamic Studies', '249+250'], ['Logic', '121+122'],
].map(([name, code], index) => ({ id: `subject-${index}`, paper_group_id: code.includes('+') ? `group-${index}` : null,
  subjects: { name, code }, result_subject_paper_groups: code.includes('+') ? { name, code } : null,
  creative_max: 10, written_max: 10, practical_max: 0 })))
const rows = Array.from({ length: 35 }, (_, index) => ({ id: `student-${index}`, name: index === 0 ? 'MD. ABU BAKAR SIDDIQUE' : `Student Example ${index + 1}`,
  admission: `28${String(601 + index)}`, roll: 28601 + index,
  subjects: Object.fromEntries(subjects.map(subject => [subject.id, { obtained: 10, absent: index === 1 && subject.id === subjects[0].id, complete: index !== 2 }])),
  totalObtained: 140, totalMax: 200, complete: index !== 2, grade: index === 2 ? 'Incomplete' : 'A', gpa: index === 2 ? null : 4, position: index + 1 }))
const marks = rows.flatMap((row, i) => subjects.map(subject => ({ id: `${row.id}:${subject.id}`, student_id: row.id,
  exam_subject_id: subject.id, creative_marks: i === 2 ? 6 : 10, written_marks: i === 2 ? null : 0,
  practical_marks: null, is_absent: row.subjects[subject.id].absent })))
const columns = model.examResultColumns(subjects[0], false)
assert.deepEqual(columns.map(column => column.label), ['MCQ', 'CQ', 'Total'])
assert.deepEqual(model.examResultColumns({ ...subjects[0], written_max: 0, creative_max: 20 }, false).map(column => column.label), ['CQ', 'Total'])
assert.deepEqual(model.examResultColumns({ ...subjects[0], creative_max: 0, written_max: 20 }, false).map(column => column.label), ['MCQ', 'Total'])
assert.deepEqual(model.examResultColumns({ ...subjects[0], written_max: 0.5 }, false).map(column => column.label), ['MCQ', 'CQ', 'Total'], 'A positive maximum must retain its column')
assert.equal(model.examResultComponentText(rows[0], subjects[0], columns[2], marks[0]), '10')
assert.equal(model.examResultComponentText(rows[2], subjects[0], columns[2], marks[20]), '—', 'Partial marks cannot produce a finished total')
assert.equal(model.examResultComponentText(rows[0], subjects[0], columns[0], marks[0]), '0', 'Recorded zero is a real mark')
assert.equal(model.examResultComponentText(rows[2], subjects[0], columns[0], marks[20]), '—', 'Missing MCQ must not become zero')
assert.equal(model.examResultComponentText(rows[2], subjects[0], columns[1], marks[20]), '6', 'Show recorded CQ even if MCQ is pending')
assert.equal(model.examResultComponentText({ ...rows[0], subjects: {} }, subjects[0], columns[1], marks[0]), '—', 'Exclude unassigned subjects')
assert.equal(model.examResultColumns({ ...subjects[0], practical_max: 25 }, false).length, 4, 'Preserve configured practical marks')
assert.equal(model.examResultColumns(subjects[0], true).length, 1, 'Legacy total-only exams retain one marks column')
assert.deepEqual(subjects.slice(0, 3).map(model.examSubjectShortName), ['Ban', 'Eng', 'ICT'])
assert.equal(model.examSubjectShortName({ ...subjects[0], paper_group_id: null, result_subject_paper_groups: null, subjects: { name: 'Bangla 2nd Paper' } }), 'Ban 2')

const props = { subjects, rows, marks, totalOnly: false }
const screen = renderToStaticMarkup(React.createElement(context.exports.ExamResultsTable, props))
const print = renderToStaticMarkup(React.createElement(context.exports.ExamResultsTable, { ...props, print: true }))
const mixedSubjects = subjects.map((subject, index) => index === 1 ? { ...subject, written_max: 0, creative_max: 20 }
  : index === 2 ? { ...subject, creative_max: 0, written_max: 20 } : subject)
for (const printMode of [false, true]) {
  const mixed = renderToStaticMarkup(React.createElement(context.exports.ExamResultsTable, { ...props, subjects: mixedSubjects, print: printMode }))
  assert.equal((mixed.match(/scope="colgroup"/g) ?? []).length, 10, 'All subject headings remain')
  assert.equal((mixed.match(/scope="col"/g) ?? []).length, 28, 'Only the two zero-maximum component columns disappear in screen and print')
}
for (const html of [screen, print]) {
  assert.equal((html.match(/scope="colgroup"/g) ?? []).length, 10)
  assert.equal((html.match(/scope="col"/g) ?? []).length, 30)
  assert.equal((html.match(/<tbody><tr/g) ?? []).length, 1)
  assert.equal((html.match(/>Absent<\/td>/g) ?? []).length, 1, 'An absence spans its subject components once')
  assert.ok(html.indexOf('Ban') < html.indexOf('101+102'), 'Short name sits above its code')
}
assert.match(print, /colspan="3"/i)
assert.doesNotMatch(print, />ID<\/th>/)
assert.ok(print.includes('result-absent'))
assert.ok(screen.includes('bg-red-50'))
assert.equal((print.split('<tbody>')[1].match(/<tr/g) ?? []).length, 35)

const ranked = model.positionExamResults([
  { ...rows[0], id: 'high-total', failedSubjects: 0, gpa: 3, totalObtained: 180 },
  { ...rows[0], id: 'high-gpa', failedSubjects: 0, gpa: 4, totalObtained: 150 },
  { ...rows[0], id: 'tied', failedSubjects: 0, gpa: 4, totalObtained: 145 },
  { ...rows[0], id: 'failed', failedSubjects: 1, gpa: 0, totalObtained: 190 },
  { ...rows[0], id: 'incomplete', failedSubjects: 0, gpa: null, complete: false },
], false)
assert.deepEqual(ranked.map(row => row.position), [3, 1, 1, null, null], 'Only passing complete students rank, by GPA with shared positions for ties')
assert.deepEqual(model.positionExamResults(ranked.slice(0, 2), true).map(row => row.position), [1, 2], 'Legacy ungraded exams retain total-based ranking')

// Optional fixture for inspecting the exact print table in a local browser.
const previewIndex = process.argv.indexOf('--preview-dir')
if (previewIndex >= 0) {
  const dir = process.argv[previewIndex + 1]; mkdirSync(dir, { recursive: true })
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8').replaceAll('@media print', '@media all')
  writeFileSync(`${dir}/exam-results-print.html`, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>body{margin:0;width:277mm}.block{display:block}.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style></head><body class="student-report-printing"><div class="student-report-print">${print}</div><script>
  const table=document.querySelector('table');
  const report={width:table.getBoundingClientRect().width,available:document.body.getBoundingClientRect().width,rows:table.tBodies[0].rows.length,
    clippedHeaders:[...table.querySelectorAll('th[scope=col] span:first-child')].filter(cell=>cell.scrollWidth>cell.clientWidth+1).length,
    columns:[...table.tBodies[0].rows[0].cells].reduce((sum,cell)=>sum+cell.colSpan,0),
    allRowsAligned:[...table.tBodies[0].rows].every(row=>[...row.cells].every(cell=>Math.abs(cell.getBoundingClientRect().top-row.getBoundingClientRect().top)<1)),
    clippedNumbers:[...table.tBodies[0].querySelectorAll('td')].filter(cell=>/^\\d+(\\.\\d+)?$/.test(cell.textContent)&&cell.scrollWidth>cell.clientWidth+1).length};
  document.body.dataset.printCheck=JSON.stringify(report);
  </script></body></html>`)
}
console.log('Passed screen/print tables: MCQ/CQ/Total groups, zero/partial marks, hidden zero-max components, no printed ID, absences and GPA-only passing positions.')
