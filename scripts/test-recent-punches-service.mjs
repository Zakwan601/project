import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const calls = []
const signals = []
let result = { data: [{ student_biometric_id: '28001', punch_date: '2026-11-19', punch_ids: ['arrival','departure'], punch_times: ['2026-11-19T02:00:00Z','2026-11-19T08:00:00Z'], first_name: 'Example', last_name: 'Student', photo_url: null, attendance_status: 'present', total_count: '7010' }], error: null }
const supabase = { rpc: (name, args) => {
  calls.push({ name,args })
  const request = Promise.resolve(result)
  request.abortSignal = signal => { signals.push(signal); return request }
  return request
}, from() { throw new Error('Paged punch requests must not download the device_logs or students tables') } }
const source = readFileSync(new URL('../src/services/deviceLogs.ts',import.meta.url),'utf8').replace(/^import .*\r?$/gm,'').replace(/^export /gm,'')
const code = ts.transpileModule(source,{ compilerOptions: { target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None } }).outputText
const context = { supabase }
vm.runInNewContext(code+'\nglobalThis.service = deviceLogsService',context)
const signal = new AbortController().signal
const page = await context.service.getDailyPunchesPage({search:'  Example  ',classId:'class-a',date:'2026-11-19',page:3,pageSize:25,signal})
assert.equal(calls.length,1)
assert.equal(calls[0].name,'search_daily_punches_page')
assert.equal(calls[0].args.p_page,3)
assert.equal(calls[0].args.p_page_size,25)
assert.equal(calls[0].args.p_class_id,'class-a')
assert.equal(calls[0].args.p_search,'Example')
assert.equal(signals[0],signal)
assert.equal(page.total,7010)
assert.equal(page.rows.length,1)
assert.equal(page.rows[0].punches.length,2)
assert.equal(page.rows[0].attendanceStatus,'present')
result={data:[],error:null}
assert.equal((await context.service.getDailyPunchesPage({page:1,pageSize:10})).rows.length,0)
result={data:null,error:new Error('Query failed')}
await assert.rejects(context.service.getDailyPunchesPage({page:1,pageSize:25}),/Query failed/)
console.log('Passed one-RPC-per-page retrieval, server-side filters, exact total and row mapping, cancellation signals, empty pages and query errors. No bulk downloads.')
