import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const compiled = ts.transpileModule(readFileSync(new URL('../src/features/results/routine-model.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { groupExamRoutineSlots } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const row = (id, name, date = '2026-11-15', time = '09:00:00') => ({ id, subject_name: name, exam_date: date, exam_time: time })
const slots = groupExamRoutineSlots([row('a', 'English'), row('b', 'Bangla'), row('c', 'Math')])
assert.equal(slots.length, 1, 'Simultaneous subjects form one routine line')
assert.equal(slots[0].subject_name, 'Bangla / English / Math')
assert.equal(groupExamRoutineSlots([row('a', 'English'), row('b', 'Math', '2026-11-15', '10:00:00')]).length, 2, 'Different times stay separate')
assert.equal(groupExamRoutineSlots([row('a', 'English'), row('b', 'Math', '2026-11-16')]).length, 2, 'Different dates stay separate')
assert.equal(groupExamRoutineSlots([row('a', 'English', undefined, null), row('b', 'Bangla', undefined, null)]).length, 1, 'Optional unset times group together')
assert.equal(groupExamRoutineSlots([row('a', 'English'), row('b', ' English ')] )[0].subject_name, 'English', 'Duplicate labels are not repeated')
assert.deepEqual(groupExamRoutineSlots([]), [])
console.log('Passed slash-separated alternatives, distinct dates/times, optional times, and duplicate labels.')
