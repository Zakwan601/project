import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const edgeSource = readFileSync(new URL('../supabase/functions/create-user/index.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, '')
const edgeCode = ts.transpileModule(edgeSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

async function exercise(options = {}) {
  let handler
  const updates = []
  const creations = []
  const profileWrites = []
  const deletions = []
  let clients = 0
  const userClient = {
    auth: { getUser: async () => ({ data: { user: options.invalidToken ? null : { id: 'caller' } }, error: null }) },
  }
  const adminClient = {
    from: table => {
      let id
      const query = {
        select: () => query,
        upsert: async values => { profileWrites.push(values); return { error: null } },
        eq: (_, value) => { id = value; return query },
        limit: async () => ({ data: options.linkedStudent ? [{ id: 'student-record' }] : [], error: options.linkError ? { message: 'Link read failed' } : null }),
        maybeSingle: async () => ({
          data: table === 'students' ? { id, profile_id: 'linked-student-id' } : id === 'caller'
            ? { role: options.callerRole ?? 'admin', is_active: options.active ?? true }
            : options.missingProfile ? null : { id, role: options.targetRole ?? 'sub_admin', is_open_account: options.openAccount ?? false },
          error: null,
        }),
      }
      return query
    },
    auth: { admin: {
      deleteUser: async (id, soft) => { deletions.push({ id, soft }); return { error: options.deleteError ? { message: 'Delete failed' } : null } },
      createUser: async values => { creations.push(values); return { data: { user: { id: 'new-staff-id' } }, error: null } },
      getUserById: async id => ({ data: { user: options.missingAuth ? null : { id, email: 'staff@example.test' } }, error: null }),
      updateUserById: async (id, values) => {
        updates.push({ id, values })
        return { error: options.resetError ? { message: 'Reset failed' } : null }
      },
    } },
  }
  vm.runInNewContext(edgeCode, {
    Request, Response,
    Deno: { env: { get: () => 'test-value' }, serve: value => { handler = value } },
    createClient: () => ++clients === 1 ? userClient : adminClient,
  })
  const response = await handler(new Request('https://example.test/create-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.noAuth ? {} : { Authorization: 'Bearer test-token' }) },
    body: JSON.stringify({ action: 'reset-sub-admin-password', profile_id: 'staff-id', password: 'Strong!Pass123', ...options.body }),
  }))
  return { status: response.status, body: await response.json(), updates, creations, profileWrites, deletions }
}

for (const [name, options, status] of [
  ['unauthenticated caller', { noAuth: true }, 401],
  ['invalid token', { invalidToken: true }, 401],
  ['sub-admin caller', { callerRole: 'sub_admin' }, 403],
  ['student caller', { callerRole: 'student' }, 403],
  ['inactive administrator', { active: false }, 403],
  ['administrator target', { targetRole: 'admin' }, 404],
  ['student target', { targetRole: 'student' }, 404],
  ['missing target', { missingProfile: true }, 404],
  ['missing auth account', { missingAuth: true }, 404],
  ['missing profile ID', { body: { profile_id: '' } }, 400],
  ['short password', { body: { password: 'short' } }, 400],
  ['invalid password type', { body: { password: 12345678 } }, 400],
  ['open account', { openAccount: true }, 403],
]) {
  const actual = await exercise(options)
  assert.equal(actual.status, status, name)
  assert.equal(actual.updates.length, 0, `${name} must never change a password`)
}
const valid = await exercise()
assert.equal(valid.status, 200)
assert.equal(valid.body.email, 'staff@example.test')
assert.equal(valid.body.password_reset, true)
assert.equal(valid.body.password, undefined, 'The API must not return a password')
assert.equal(valid.updates.length, 1)
assert.equal(valid.updates[0].id, 'staff-id')
assert.equal(valid.updates[0].values.password, 'Strong!Pass123')
assert.equal((await exercise({ resetError: true })).status, 400)

for (const [name, options, status] of [
  ['no authorization', { noAuth: true }, 401],
  ['invalid token', { invalidToken: true }, 401],
  ['staff caller', { callerRole: 'sub_admin' }, 403],
  ['student caller', { callerRole: 'student' }, 403],
  ['inactive admin', { active: false }, 403],
  ['admin target', { targetRole: 'admin' }, 404],
  ['student target', { targetRole: 'student' }, 404],
  ['missing target', { missingProfile: true }, 404],
  ['self deletion', { body: { profile_id: 'caller' } }, 400],
  ['missing ID', { body: { profile_id: '' } }, 400],
  ['student-linked staff', { linkedStudent: true }, 400],
  ['student link query fails', { linkError: true }, 500],
]) {
  const result = await exercise({ ...options, body: { action: 'delete-sub-admin', ...options.body } })
  assert.equal(result.status, status, name)
  assert.equal(result.deletions.length, 0, `${name} must not delete a user`)
}
for (const openAccount of [false, true]) {
  const result = await exercise({ openAccount, body: { action: 'delete-sub-admin' } })
  assert.equal(result.status, 200, 'Administrator can delete standard and open staff accounts')
  assert.deepEqual(result.deletions, [{ id: 'staff-id', soft: true }])
  assert.equal(result.updates.length, 0)
}
assert.equal((await exercise({ deleteError: true, body: { action: 'delete-sub-admin' } })).status, 400)

const studentLogin = await exercise({ body: { action: 'get-student-login', student_id: 'student-record' } })
assert.equal(studentLogin.status, 200, 'Existing student login retrieval still works')
assert.equal(studentLogin.updates.length, 0, 'Retrieving student login details must not reset a password')
const studentReset = await exercise({ body: { action: 'reset-student-password', student_id: 'student-record' } })
assert.equal(studentReset.status, 200, 'Existing student password reset still works')
assert.equal(studentReset.updates[0].id, 'linked-student-id')

const newAccount = { action: 'create', email: 'teacher@example.test', full_name: 'Example Staff', role: 'sub_admin' }
const teacherAccount = await exercise({ body: { ...newAccount, sub_admin_label: 'teacher' } })
assert.equal(teacherAccount.status, 200)
assert.equal(teacherAccount.creations.length, 1)
assert.equal(teacherAccount.profileWrites[0].sub_admin_label, 'teacher')
assert.equal(teacherAccount.profileWrites[0].role, 'sub_admin', 'Teacher label must preserve the authorization role')
assert.equal(teacherAccount.profileWrites[0].is_active, true)
const standardAccount = await exercise({ body: newAccount })
assert.equal(standardAccount.status, 200)
assert.equal(standardAccount.profileWrites[0].sub_admin_label, 'sub_admin', 'Existing clients retain the default title')
assert.equal(standardAccount.profileWrites[0].role, 'sub_admin')
const invalidLabel = await exercise({ body: { ...newAccount, sub_admin_label: 'admin' } })
assert.equal(invalidLabel.status, 400)
assert.equal(invalidLabel.creations.length, 0, 'Invalid labels must be rejected before creating any account')

const dialogSource = readFileSync(new URL('../src/features/access/SubAdminLoginDialog.tsx', import.meta.url), 'utf8')
const passwordCode = ts.transpileModule(dialogSource.slice(dialogSource.indexOf('export function generateTemporaryPassword')), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const { generateTemporaryPassword } = await import(`data:text/javascript;base64,${Buffer.from(passwordCode).toString('base64')}`)
for (let index = 0; index < 100; index++) {
  const password = generateTemporaryPassword()
  assert.equal(password.length, 12)
  for (const group of [/[A-Z]/, /[a-z]/, /[0-9]/, /[!@#$%]/]) assert.match(password, group)
}
console.log('Passed administrator authorization, target-role protection, open-account reset blocking, safe staff deletion, API errors, and temporary-password generation checks.')
