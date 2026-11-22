import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

// Used by upload-routine-image.ps1. Credentials stay in memory and are never logged.
const [imagePath, objectPath, contentType] = process.argv.slice(2)
if (!imagePath || !/^grade-(11|12)\/20\d{2}-20\d{2}\/[a-f0-9]{32}\.(jpg|jpeg|png|webp)$/.test(objectPath ?? '')) {
  throw new Error('Expected an image and a grade/session routine object path.')
}
const projectRef = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim()
const cli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url))
const result = spawnSync(process.execPath, [cli, 'projects', 'api-keys', '--project-ref', projectRef, '--output', 'json'], { encoding: 'utf8' })
if (result.status !== 0) throw new Error('Could not authenticate with the linked Supabase project.')
const key = JSON.parse(result.stdout).find(row => row.name === 'service_role')?.api_key
if (!key) throw new Error('Linked Supabase project did not provide a storage administration key.')
const client = createClient(`https://${projectRef}.supabase.co`, key, { auth: { persistSession: false, autoRefreshToken: false } })
const bytes = readFileSync(imagePath)
const bucket = client.storage.from('class-routines')
const { error } = await bucket.upload(objectPath, bytes, { contentType, cacheControl: '3600', upsert: false })
if (error) throw new Error(`Routine upload failed: ${error.message}`)
const url = bucket.getPublicUrl(objectPath, { download: true }).data.publicUrl
const response = await fetch(url)
if (!response.ok) throw new Error(`Public download verification failed: HTTP ${response.status}`)
const downloaded = Buffer.from(await response.arrayBuffer())
const hash = data => createHash('sha256').update(data).digest('hex')
if (hash(bytes) !== hash(downloaded)) throw new Error('Downloaded image does not match the original attachment.')
if (!response.headers.get('content-disposition')?.includes('attachment')) throw new Error('Routine URL did not return a downloadable attachment.')
console.log(`Uploaded and verified original image: ${objectPath} (${bytes.length} bytes)`)
