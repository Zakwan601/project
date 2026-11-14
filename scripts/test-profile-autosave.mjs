import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/autosave.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { createAutosaveQueue } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('rapid edits stay editable and persist in order, with the newest field values winning', async () => {
  const writes = []
  let finishFirst
  const firstRequest = new Promise(resolve => { finishFirst = resolve })
  let active = 0
  const queue = createAutosaveQueue(async patch => {
    assert.equal(++active, 1, 'Only one database write may run at a time')
    writes.push(patch)
    if (writes.length === 1) await firstRequest
    active--
  })
  queue.enqueue({ father_name: 'First' })
  queue.enqueue({ father_name: 'Newer', mother_name: 'Mother' })
  queue.enqueue({ father_name: 'Latest' })
  assert.equal(writes.length, 1)
  assert.equal(queue.getSnapshot().status, 'saving')
  finishFirst()
  await queue.flush()
  assert.deepEqual(writes, [{ father_name: 'First' }, { father_name: 'Latest', mother_name: 'Mother' }])
  assert.equal(queue.getSnapshot().status, 'saved')
})

test('typing pauses merge fields and issue one write after the debounce', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const writes = []
  const queue = createAutosaveQueue(async patch => { writes.push(patch) }, 350)
  queue.enqueue({ father_name: 'A' })
  t.mock.timers.tick(200)
  queue.enqueue({ father_name: 'Ali' })
  queue.enqueue({ mother_name: 'B' })
  t.mock.timers.tick(349)
  assert.deepEqual(writes, [])
  t.mock.timers.tick(1)
  await queue.flush()
  assert.deepEqual(writes, [{ father_name: 'Ali', mother_name: 'B' }])
})

test('leaving a field or tab flushes pending edits immediately', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const writes = []
  const queue = createAutosaveQueue(async patch => { writes.push(patch) }, 350)
  queue.enqueue({ secondary_phone: '+8801712345678' })
  await queue.flush()
  assert.equal(writes.length, 1)
  t.mock.timers.tick(1000)
  assert.equal(writes.length, 1, 'The cancelled debounce must not duplicate the save')
})

test('failed saves are marked unsaved and retained with newer edits for reconnect retry', async () => {
  const writes = []
  let rejectFirst
  const firstRequest = new Promise((_resolve, reject) => { rejectFirst = reject })
  const queue = createAutosaveQueue(async patch => {
    writes.push(patch)
    if (writes.length === 1) await firstRequest
  })
  queue.enqueue({ father_name: 'First', mother_name: 'Keep me' })
  queue.enqueue({ father_name: 'Latest' })
  rejectFirst(new Error('Offline'))
  await queue.flush()
  assert.equal(queue.getSnapshot().status, 'error')
  assert.equal(queue.getSnapshot().error, 'Offline')
  await queue.flush()
  assert.deepEqual(writes[1], { father_name: 'Latest', mother_name: 'Keep me' })
  assert.equal(queue.getSnapshot().status, 'saved')
})

test('a new edit after a failed save retries the failed fields as well', async () => {
  const writes = []
  const queue = createAutosaveQueue(async patch => {
    writes.push(patch)
    if (writes.length === 1) throw new Error('Temporary failure')
  })
  queue.enqueue({ father_name: 'Retain' })
  await queue.flush()
  queue.enqueue({ mother_name: 'New edit' })
  await queue.flush()
  assert.deepEqual(writes[1], { father_name: 'Retain', mother_name: 'New edit' })
})
