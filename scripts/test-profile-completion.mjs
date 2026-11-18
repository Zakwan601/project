import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/profile.ts', import.meta.url), 'utf8')
const subjectsSource = readFileSync(new URL('../src/lib/studentSubjects.ts', import.meta.url), 'utf8')
const subjectsCompiled = ts.transpileModule(subjectsSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const subjectsUrl = `data:text/javascript;base64,${Buffer.from(subjectsCompiled).toString('base64')}`
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('./studentSubjects', subjectsUrl)
const { isProfileComplete, getStudentProfileMissingRequirements } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)

const profile = { role: 'student', avatar_url: null }
const student = { class_group: 'science', group_fourth_option_id: 'biology', guardian_phone: '01712345678', student_phone: '01812345678', present_address: 'Dhaka', permanent_address: 'Chattogram', photo_url: null }

assert.equal(isProfileComplete(profile, student), false, 'A guardian phone alone must not unlock the dashboard')
assert.equal(isProfileComplete(profile, { ...student, photo_url: '   ' }), false, 'Blank photo URLs must not unlock access')
assert.equal(isProfileComplete(profile, { ...student, photo_url: 'https://example.com/photo.jpg' }), true, 'A saved student photo unlocks access')
const uploadedProfile = { ...profile, avatar_url: 'https://example.com/avatar.jpg' }
assert.equal(isProfileComplete(uploadedProfile, student), true, 'An existing profile photo counts toward completion')
assert.equal(isProfileComplete(uploadedProfile, { ...student, group_fourth_option_id: null }), false, 'Missing subject choices keep a photographed student locked')
assert.equal(isProfileComplete(uploadedProfile, { ...student, guardian_phone: '' }), false, 'A photo does not bypass the guardian phone requirement')
assert.equal(isProfileComplete(uploadedProfile, null), false, 'An unlinked student remains locked')
assert.equal(isProfileComplete(profile, student), false, 'Removing the photo locks access again')
assert.equal(isProfileComplete({ role: 'admin', phone: student.guardian_phone }), true, 'Admins do not need a photo')
assert.equal(isProfileComplete({ role: 'admin', phone: '' }), false, 'Admin phone requirements remain in effect')
assert.equal(isProfileComplete({ role: 'sub_admin' }), true, 'Sub-admin access remains governed by permissions')
assert.equal(isProfileComplete(null), false, 'Missing profiles remain locked')
assert.deepEqual(getStudentProfileMissingRequirements(student), ['Profile photo'], 'Admin status identifies the missing photo')
const completeStudent = { ...student, photo_url: 'https://example.com/photo.jpg' }
assert.deepEqual(getStudentProfileMissingRequirements(completeStudent), [], 'Complete records are marked complete in the admin list')
assert.equal(isProfileComplete(profile, completeStudent), getStudentProfileMissingRequirements(completeStudent).length === 0, 'Admin list and dashboard use the same completion rule')
assert.deepEqual(getStudentProfileMissingRequirements({ ...student, guardian_phone: '', group_fourth_option_id: null }), ['Profile photo', 'Guardian phone', 'Subject choices'], 'Incomplete rows explain every missing requirement')

for (const [field, label] of [['student_phone', 'Student phone'], ['present_address', 'Present address'], ['permanent_address', 'Permanent address']]) {
  for (const missing of [null, undefined, '', '   ', '\t\n']) {
    const incomplete = { ...completeStudent, [field]: missing }
    assert.equal(isProfileComplete(profile, incomplete), false, `${label} is compulsory`)
    assert.ok(getStudentProfileMissingRequirements(incomplete).includes(label))
  }
}
assert.equal(isProfileComplete(profile, { ...completeStudent, student_phone: '123' }), false, 'Student phone must be valid')
assert.equal(isProfileComplete(profile, { ...completeStudent, student_phone: '+8801812345678' }), true, 'International phone format is supported')
assert.deepEqual(getStudentProfileMissingRequirements({ ...completeStudent, student_phone: null, present_address: null, permanent_address: null }), ['Student phone', 'Present address', 'Permanent address'])
console.log('Passed required student phone and addresses, photo and subject requirements, guardian phone, and staff access checks.')
