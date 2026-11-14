import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { z } from 'zod'

const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const source = readFileSync(new URL('../src/lib/studentSubjects.ts', import.meta.url), 'utf8')
const { getStudentSubjectErrors, hasRequiredStudentSubjects, studentSubjectUpdate } = await import(
  `data:text/javascript;base64,${Buffer.from(compile(source)).toString('base64')}`
)
const profileSource = readFileSync(new URL('../src/lib/profile.ts', import.meta.url), 'utf8')
const phoneValidator = compile(profileSource.slice(profileSource.indexOf('function compactPhone'), profileSource.indexOf('export function normalizeBangladeshMobile')))
  .replace('export ', '')
const adminSource = readFileSync(new URL('../src/features/students/StudentsPage.tsx', import.meta.url), 'utf8')
const schemaSource = adminSource.slice(adminSource.indexOf('const BLOOD_GROUPS'), adminSource.indexOf('type StudentForm'))
const schema = new Function('z', 'getStudentSubjectErrors', `${phoneValidator}\n${compile(schemaSource)}\nreturn studentSchema`)(z, getStudentSubjectErrors)

const option = (id, group, elective = true, fourth = true) => ({
  id, class_group: group, is_active: true, available_as_elective: elective, available_as_fourth: fourth,
})
const options = [
  option('biology', 'science', false), option('math', 'science', false),
  option('finance', 'business'), option('marketing', 'business'), option('home', 'business', false),
  ...['civics', 'social', 'economics', 'logic'].map(id => option(id, 'humanities')),
]
const choices = {
  science: { class_group: 'science', group_fourth_option_id: 'biology' },
  business: { class_group: 'business', group_elective_option_id: 'finance', group_fourth_option_id: 'home' },
  humanities: { class_group: 'humanities', humanities_main_option_1_id: 'civics', humanities_main_option_2_id: 'social', humanities_main_option_3_id: 'economics', group_fourth_option_id: 'logic' },
}
const adminBase = { first_name: 'Test', last_name: 'Student', admission_number: '28001' }
for (const [group, selected] of Object.entries(choices)) {
  assert.equal(hasRequiredStudentSubjects({ class_group: group }), false, `${group}: students must select subjects`)
  assert.equal(hasRequiredStudentSubjects(selected), true, `${group}: complete selections satisfy the profile gate`)
  assert.deepEqual(getStudentSubjectErrors(selected, options), {}, `${group}: valid active choices pass`)
  assert.equal(schema.safeParse({ ...adminBase, class_group: group }).success, true, `${group}: admin can omit all choices`)
  assert.equal(schema.safeParse({ ...adminBase, ...selected }).success, true, `${group}: admin can provide valid choices`)
}
const duplicateBusiness = { ...choices.business, group_fourth_option_id: 'finance' }
const duplicateHumanities = { ...choices.humanities, group_fourth_option_id: 'civics' }
for (const duplicate of [duplicateBusiness, duplicateHumanities]) {
  assert.equal(hasRequiredStudentSubjects(duplicate), false, 'Duplicate courses keep profiles locked')
  assert.equal(schema.safeParse({ ...adminBase, ...duplicate }).success, false, 'Admins must also avoid duplicates')
}
assert.ok(getStudentSubjectErrors({ ...choices.business, group_elective_option_id: 'home' }, options).group_elective_option_id, 'Fourth-only courses cannot be electives')
assert.ok(getStudentSubjectErrors({ ...choices.science, group_fourth_option_id: 'finance' }, options).group_fourth_option_id, 'Cross-group choices fail')
assert.ok(getStudentSubjectErrors(choices.science, options.map(item => ({ ...item, is_active: false }))).group_fourth_option_id, 'Inactive courses fail')
assert.equal(hasRequiredStudentSubjects({ ...choices.humanities, humanities_main_option_2_id: null }), false, 'All three Humanities electives are required')
assert.equal(hasRequiredStudentSubjects({ ...choices.business, group_elective_option_id: null }), false, 'Business elective is required')
for (const group of ['business', 'humanities']) {
  const partial = group === 'business'
    ? { class_group: group, group_elective_option_id: 'finance' }
    : { class_group: group, humanities_main_option_1_id: 'civics' }
  assert.deepEqual(getStudentSubjectErrors(partial, options, false), {}, 'Valid partial selections may autosave')
  assert.equal(hasRequiredStudentSubjects(partial), false, 'Autosaving a partial selection must not unlock the profile')
}
assert.equal(studentSubjectUpdate(choices.science).group_elective_option_id, null, 'Science has no elective selector')
assert.equal(studentSubjectUpdate(choices.humanities).humanities_fourth_option_id, 'logic', 'Humanities fourth-subject compatibility field follows the choice')
assert.equal(studentSubjectUpdate(choices.business).humanities_main_option_1_id, null, 'Other groups clear Humanities choices')
console.log('Passed group requirements, admin optionality, duplicate prevention, active/group eligibility, and subject-save payload checks.')
