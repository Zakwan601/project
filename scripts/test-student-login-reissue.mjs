import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../supabase/functions/bulk-student-logins/index.ts', import.meta.url), 'utf8')
const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
const helpers = file.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(file)).join('\n')
const compiled = ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const context = vm.createContext({ crypto: webcrypto })
vm.runInContext(compiled, context)
const student = { id: 'student-1', profile_id: 'auth-1', first_name: 'Test', last_name: 'Student', roll_number: 28, classes: { name: 'XI', section: 'A' } }
function client({ role = 'student', active = true, email = 'custom-email@example.edu', lookupError = null, resetError = null } = {}) {
  const resets = []
  let lookups = 0
  const query = { select() { return this }, eq() { return this }, async maybeSingle() { return { data: { role, is_active: active }, error: null } } }
  return {
    resets,
    get lookups() { return lookups },
    from() { return query },
    auth: { admin: {
      async getUserById(id) { lookups++; assert.equal(id, 'auth-1'); return { data: { user: { email, user_metadata: { full_name: 'Keep me' } } }, error: lookupError } },
      async updateUserById(id, payload) { resets.push({ id, payload }); return { error: resetError } },
      async createUser() { throw new Error('An existing login must never be recreated') },
    } },
  }
}
const admin = client()
const result = await context.reissueStudentLogin(admin, student)
assert.equal(result.status, 'created')
assert.equal(result.credential.email, 'custom-email@example.edu', 'Retain actual login email, including custom addresses')
assert.equal(admin.resets.length, 1)
assert.equal(admin.resets[0].payload.password, result.credential.password)
assert.equal(admin.resets[0].payload.user_metadata.full_name, 'Keep me')
assert.equal(admin.resets[0].payload.user_metadata.must_change_password, true)
assert.match(result.credential.password, /[A-Z]/)
assert.match(result.credential.password, /[a-z]/)
assert.match(result.credential.password, /[2-9]/)
assert.match(result.credential.password, /[!@#$%]/)
assert.equal(result.credential.password.length, 12)
for (const options of [{ role: 'admin' }, { active: false }, { email: null }, { lookupError: { message: 'Missing' } }]) {
  const mock = client(options)
  assert.equal((await context.reissueStudentLogin(mock, student)).status, 'failed')
  assert.equal(mock.resets.length, 0, 'Invalid linked accounts must not be changed')
}
const failing = client({ resetError: { message: 'Reset failed' } })
const failure = await context.reissueStudentLogin(failing, student)
assert.equal(failure.status, 'failed')
assert.equal(failure.failure.error, 'Reset failed')
assert.equal(failure.credential, undefined, 'Do not export passwords that failed to update')
assert.equal((await context.createStudentLogin(client(), student, 'example.edu')).status, 'skipped', 'Original creation action must still skip existing accounts')
const csv = context.buildCsv([result.credential])
assert.ok(csv.includes('"Login Email","Temporary Password"'))
assert.ok(csv.includes('"custom-email@example.edu"'))
assert.ok(csv.includes(`"${result.credential.password}"`))
assert.equal(context.csvCell('=danger'), '"\'=danger"')
// Exercise the HTTP authorization boundary with mocked clients, without network calls.
let handler
let currentRole = 'teacher'
let clientCalls = 0
const runtime = vm.createContext({
  crypto: webcrypto, Request, Response, Blob,
  Deno: { env: { get: () => 'test-value' }, serve: fn => { handler = fn } },
  createClient: () => {
    clientCalls++
    return {
      auth: { getUser: async () => ({ data: { user: { id: 'caller' } }, error: null }) },
      from: () => ({ select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: { role: currentRole, is_active: true } }) }),
    }
  },
})
const handlerSource = file.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(file)).join('\n')
vm.runInContext(ts.transpileModule(handlerSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, runtime)
const unsigned = await handler(new Request('https://test.example', { method: 'POST', body: '{}' }))
assert.equal(unsigned.status, 401)
assert.equal(clientCalls, 0)
const denied = await handler(new Request('https://test.example', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ action: 'reissue', student_ids: ['student-1'] }) }))
assert.equal(denied.status, 403, 'Non-admins must never reach password reset or export code')
console.log('Passed HTTP authorization, existing-login resets, actual email retention, account guards, failure handling, creation compatibility, password strength, and CSV output. No live passwords changed.')
