import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { webcrypto } from 'node:crypto'

const classId = '4a4212a0-e748-4c2e-84b4-59a6884fc401'
async function exercise(name, { method = 'POST', body = {}, assigned = false, scopeError = false } = {}) {
  const source = readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8').replace(/^import .*;\r?$/gm, '')
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  let handler
  let privilegedReads = 0
  let providerCalls = 0
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'teacher-id' } }, error: null }) },
    rpc: async name => ({
      data: name === 'is_class_restricted_teacher' ? true : name === 'has_permission' ? true : assigned,
      error: scopeError && name !== 'has_permission' ? { message: 'Scope unavailable' } : null,
    }),
    from: () => {
      let selfProfile = false
      const query = {
        select: columns => { selfProfile = columns.includes('is_active'); return query },
        eq: () => query,
        maybeSingle: async () => {
          if (selfProfile) return { data: { is_active: true, role: 'sub_admin', sub_admin_label: 'teacher' }, error: null }
          privilegedReads++
          return { data: null, error: null }
        },
      }
      return query
    },
  }
  vm.runInNewContext(code, {
    Request, Response, URL, TextEncoder, crypto: webcrypto, console: { log() {}, error() {}, warn() {} },
    Deno: { env: { get: name => name.includes('URL') ? 'https://example.invalid' : 'test-value' }, serve: value => { handler = value } },
    createClient: () => client,
    fetch: async () => { providerCalls++; throw new Error('No external requests are allowed in tests') },
  })
  const url = `https://example.invalid/${name}?class_id=${classId}&date=2026-11-18`
  const response = await handler(new Request(url, { method, headers: { Authorization: 'Bearer teacher-token', 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }))
  return { status: response.status, body: await response.json(), privilegedReads, providerCalls }
}

for (const name of ['sync-attendance', 'absent-students']) {
  const result = await exercise(name)
  assert.equal(result.status, 403, `${name} must reject school-wide operations for teachers`)
  assert.equal(result.privilegedReads, 0)
  assert.equal(result.providerCalls, 0)
}
for (const method of ['GET', 'POST']) {
  const result = await exercise('analyze-departure-anomalies', { method, body: { class_id: classId, date: '2026-11-18', departure_time: '14:00' } })
  assert.equal(result.status, 403, `${method} must reject an unassigned class before reading cached data`)
  assert.equal(result.privilegedReads, 0)
  const failedScope = await exercise('analyze-departure-anomalies', { method, scopeError: true, body: { class_id: classId, date: '2026-11-18', departure_time: '14:00' } })
  assert.equal(failedScope.status, 403, 'Permission lookup failures must fail closed')
}
const assignedAnalysis = await exercise('analyze-departure-anomalies', { method: 'GET', assigned: true })
assert.equal(assignedAnalysis.status, 404, 'An assigned teacher may check for a saved report')
assert.equal(assignedAnalysis.privilegedReads, 1)
const smsBody = { message: 'Test message', contacts: ['01712345678'], source: 'result_published', studentId: 'student-id', resultExamId: classId, resultShareLinkId: classId }
for (const source of ['manual','result_published']) {
  const result = await exercise('send-sms', { body: { ...smsBody, source } })
  assert.equal(result.status, 403, 'Teacher cannot send manual SMS or result notifications for another class')
  assert.equal(result.privilegedReads, 0)
  assert.equal(result.providerCalls, 0)
}
console.log('Passed teacher scope checks for attendance sync, absence notifications, cached and fresh departure analysis, SMS recipients, and permission lookup failures. No external messages sent.')
