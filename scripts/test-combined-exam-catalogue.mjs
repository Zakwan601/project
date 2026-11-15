import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/features/results/result-model.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { buildExamSubjectCatalogue } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const subject = (id, name, code, extra = {}) => ({ id, name, code, class_group: 'science', is_active: true, is_fourth_subject: false, ...extra })
const first = subject('first', 'Bangla  1st Paper (বাংলা)', '101')
const second = subject('second', 'Bangla 2nd Paper (বাংলা)', '102', { is_fourth_subject: true })
const ict = subject('ict', 'ICT (তথ্য ও যোগাযোগ প্রযুক্তি)', '275')
const group = { id: 'bangla', class_group: 'science', name: 'Bangla (বাংলা)', code: '101+102', first_paper_subject_id: 'first', second_paper_subject_id: 'second', is_active: true }

const combined = buildExamSubjectCatalogue([first, second, ict], [group], true)
assert.equal(combined.length, 2, 'Combined mode has one course plus ICT, rather than three individual rows')
assert.deepEqual(combined.find(item => item.paper_group_id), { ...first, name: group.name, code: group.code, is_fourth_subject: true, paper_group_id: group.id }, 'The combined row keeps the canonical first-paper ID, bilingual label and group ID for saving')
assert.equal(combined.some(item => item.id === second.id), false, 'Second papers never appear beside the combined course')
assert.equal(combined.find(item => item.id === ict.id).paper_group_id, null, 'Genuine single-paper courses remain available')
const separate = buildExamSubjectCatalogue([first, second, ict], [group], false)
assert.equal(separate.length, 3, 'Separate mode keeps both papers')
assert.ok(separate.every(item => item.paper_group_id === null), 'Separate-mode payloads do not reference combined groups')
assert.equal(separate[0].name, first.name, 'Separate mode preserves individual paper names')
assert.deepEqual(buildExamSubjectCatalogue([first, ict], [group], true).map(item => item.id), ['ict'], 'A missing counterpart does not expose an individual paper in combined mode')
assert.deepEqual(buildExamSubjectCatalogue([first, second, ict], [], true).map(item => item.id), ['ict'], 'Missing pairing metadata cannot make combined mode fall back to individual papers')
assert.deepEqual(buildExamSubjectCatalogue([first, second, ict], [{ ...group, is_active: false }], true).map(item => item.id), ['ict'], 'Disabled pairs cannot fall back to individual paper choices')
assert.deepEqual(buildExamSubjectCatalogue([{ ...first, name: 'Custom label' }, ict], [group], true).map(item => item.id), ['ict'], 'Known paper IDs stay hidden even when a custom name omits its paper suffix')
assert.deepEqual(buildExamSubjectCatalogue([first, second, ict], [{ ...group, class_group: 'business' }], true).map(item => item.id), ['ict'], 'Pairs from other academic groups are never offered')
assert.deepEqual(buildExamSubjectCatalogue([subject('one', 'Home Science First Paper (গার্হস্থ্য বিজ্ঞান)', '273'), subject('two', 'Home Science Second Paper (গার্হস্থ্য বিজ্ঞান)', '274')], [], true), [], 'Written-out paper ordinals also stay hidden without a valid pair')
assert.equal(buildExamSubjectCatalogue([first, second, ict], [group], false).length, 3, 'Switching back to separate mode restores both papers')
console.log('Passed combined/separate catalogues, bilingual names, single-paper subjects, payload IDs, missing metadata, and class-group isolation.')
