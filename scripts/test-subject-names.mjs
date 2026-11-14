import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/subjectNames.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { createSubjectNameLookup } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const group = {
  class_group: 'humanities', name: 'Civics and Good Governance (পৌরনীতি ও সুশাসন)',
  first_paper_subject_id: 'civics-1', second_paper_subject_id: 'civics-2', is_active: false,
}
const names = createSubjectNameLookup([group])
const course = { ...group, name: 'Civics & Good Governance' }
assert.equal(names.courseName(course), group.name, 'Paper IDs match bilingual names even when English spellings differ and the exam group is inactive')
assert.equal(names.subjectName({ id: 'civics-1', class_group: 'humanities', name: 'Civics 1st Paper' }), 'Civics 1st Paper (পৌরনীতি ও সুশাসন ১ম পত্র)', 'First-paper list labels include the stored Bangla name')
assert.equal(names.subjectName({ id: 'civics-2', class_group: 'humanities', name: 'Civics 2nd Paper' }), 'Civics 2nd Paper (পৌরনীতি ও সুশাসন ২য় পত্র)', 'Second-paper labels remain distinct')
assert.equal(names.courseName({ ...course, class_group: 'science' }), course.name, 'Labels never cross student groups')
assert.equal(names.subjectName({ id: 'civics-1', class_group: 'science', name: 'Other subject' }), 'Other subject', 'Paper labels are scoped to their group')
assert.equal(names.subjectName({ id: 'ict', class_group: 'humanities', name: 'ICT (আইসিটি)' }), 'ICT (আইসিটি)', 'Existing single-paper bilingual names are preserved')
assert.equal(names.subjectName({ id: 'civics-1', class_group: 'humanities', name: 'Civics 1st Paper (পৌরনীতি)' }), 'Civics 1st Paper (পৌরনীতি)', 'Existing Bangla names are not duplicated')
assert.equal(names.courseName({ ...course, first_paper_subject_id: 'missing' }), course.name, 'Missing mappings keep the original course name')
assert.equal(createSubjectNameLookup([{ ...group, name: 'Civics' }]).courseName(course), course.name, 'English-only records do not replace existing course names')
console.log('Passed bilingual course names, first/second papers, inactive metadata, group scoping, existing translations, and missing-label fallbacks.')
