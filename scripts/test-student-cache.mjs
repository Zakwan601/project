import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import { QueryClient, QueryObserver } from '@tanstack/react-query'

const require = createRequire(import.meta.url)
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
let auth = { user: { id: 'admin' }, accessScope: 'admin-all', loading: false }
const students = [{ id: 'a', class_id: 'science', first_name: 'Science pupil', is_active: true }, { id: 'b', class_id: 'business', first_name: 'Business pupil', is_active: true }]
let calls = 0, details = 0, periods = 0
const authorized = () => auth.accessScope === 'admin-all' ? students : students.filter(row => row.class_id === (auth.accessScope === 'teacher-science' ? 'science' : 'business'))
const service = {
  async getAll(classId, signal) { assert.equal(classId, undefined); assert.ok(signal); calls++; return structuredClone(authorized()) },
  async getById(id) { details++; return structuredClone(authorized().find(row => row.id === id) ?? null) },
  async getByClassForPeriod() { periods++; return [{ id: 'former-pupil', class_id: 'business', is_active: false }] },
}
const modules = new Map()
function load(path) {
  if (modules.has(path)) return modules.get(path)
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const context = { exports: {}, require(name) {
    if (name === 'react') return { useCallback: callback => callback }
    if (name === '@tanstack/react-query') return { useQuery: options => options, useMutation: options => options, useQueryClient: () => client }
    if (name === '@/contexts/AuthContext') return { useAuth: () => auth }
    if (name === '@/services/students') return { studentsService: service }
    if (name === '@/lib/studentQueryCache') return load('../src/lib/studentQueryCache.ts')
    if (name === '@/hooks/useDashboard') return { ADMIN_DASHBOARD_KEY: 'admin-dashboard' }
    if (name === 'sonner') return { toast: { success() {}, error() {} } }
    return require(name)
  } }
  vm.runInNewContext(code, context)
  modules.set(path, context.exports)
  return context.exports
}
const hooks = load('../src/hooks/useStudents.ts')
const observers = []
async function observe(options) {
  const observer = new QueryObserver(client, options)
  const unsubscribe = observer.subscribe(() => {})
  observers.push(() => { unsubscribe(); observer.destroy() })
  await client.fetchQuery(options)
  return observer.getCurrentResult().data
}
try {
  const all = hooks.useStudents()
  assert.equal(all.staleTime, 600_000)
  assert.equal(all.gcTime, 1_800_000, 'Unused lists survive navigation for 30 minutes')
  assert.equal(all.refetchInterval, 600_000, 'Visible lists periodically refresh changes from other devices')
  assert.equal(all.refetchIntervalInBackground, false)
  assert.equal((await observe(all)).length, 2, 'Admin retains all students')
  assert.equal((await observe(hooks.useStudents('science')))[0].id, 'a')
  assert.equal((await observe(hooks.useStudents('business')))[0].id, 'b')
  assert.equal(calls, 1, 'Different screens/classes share a single server request')
  assert.equal((await observe(hooks.useStudent('a'))).id, 'a')
  assert.equal(details, 0, 'A fresh cached student seeds detail queries')

  auth = { user: { id: 'teacher' }, accessScope: 'teacher-science', loading: false }
  assert.equal((await observe(hooks.useStudents())).length, 1)
  assert.equal((await observe(hooks.useStudents('business'))).length, 0, 'Teacher cannot inherit admin data through class filtering')
  assert.equal(await observe(hooks.useStudent('b')), null, 'Unassigned details cannot be seeded from admin cache')
  auth = { ...auth, accessScope: 'teacher-business' }
  assert.equal((await observe(hooks.useStudents()))[0].id, 'b', 'Changing assignments uses a new cache scope')
  assert.equal((await observe(hooks.useStudents('science'))).length, 0, 'Previous teacher assignment data is not reused')
  auth = { ...auth, user: { id: 'another-teacher' } }
  const beforeSwitch = calls
  await observe(hooks.useStudents())
  assert.equal(calls, beforeSwitch + 1, 'Accounts cannot share cached student data')
  auth = { ...auth, loading: true }
  assert.equal(hooks.useStudents().enabled, false, 'No list requests while access is being loaded')
  auth = { ...auth, loading: false }

  const historical = hooks.useStudentsForPeriod('science', '2020-01-01')
  assert.equal((await observe(historical))[0].id, 'former-pupil', 'Historical rosters retain prior enrollment instead of using current class filtering')
  assert.equal(periods, 1)
  observers.splice(0).forEach(stop => stop())
  for (const hook of ['useCreateStudent', 'useUpdateStudent', 'useDeleteStudent', 'usePromoteStudents', 'useAssignStudentsToClass']) {
    await client.fetchQuery(hooks.useStudents())
    await client.fetchQuery(historical)
    hooks[hook]().onSuccess(1)
    assert.equal(client.getQueryState(hooks.useStudents().queryKey).isInvalidated, true, `${hook} invalidates shared lists`)
    assert.equal(client.getQueryState(historical.queryKey).isInvalidated, true, `${hook} invalidates historical rosters`)
  }
  console.log('Passed shared student caching, detail reuse, mutation invalidation, historical rosters, account isolation and teacher assignment isolation.')
} finally {
  observers.forEach(stop => stop())
  client.clear()
}

// Exercise the actual paginated service, including the Supabase row-limit boundary.
const directory = Array.from({ length: 1205 }, (_, index) => ({ id: String(index), class_id: index < 1001 ? 'science' : 'business' }))
let requestCount = 0
const db = { from(table) {
  assert.equal(table, 'students')
  let start = 0, end = 999, classId
  const query = {
    select() { return query }, order() { return query },
    eq(key, value) { assert.equal(key, 'class_id'); classId = value; return query },
    range(from, to) { start = from; end = to; return query },
    async abortSignal(signal) {
      signal?.throwIfAborted(); requestCount++
      return { data: directory.filter(row => !classId || row.class_id === classId).slice(start, end + 1), error: null }
    },
  }
  return query
} }
const serviceContext = { exports: {}, require(name) {
  if (name === '@/lib/supabase') return { supabase: db }
  throw new Error(`Unexpected service dependency: ${name}`)
} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/services/students.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, serviceContext)
assert.equal((await serviceContext.exports.studentsService.getAll()).length, 1205, 'Full admin list must not be truncated at 1,000 students')
assert.equal(requestCount, 2)
assert.equal((await serviceContext.exports.studentsService.getAll('science')).length, 1001, 'Class filters apply to every page')
const controller = new AbortController(); controller.abort()
await assert.rejects(serviceContext.exports.studentsService.getAll(undefined, controller.signal), { name: 'AbortError' })
console.log('Passed complete directory pagination, per-page filtering and canceled-request handling.')
