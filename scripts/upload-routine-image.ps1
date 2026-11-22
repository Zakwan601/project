param(
  [Parameter(Mandatory=$true)][ValidateSet('11','12')][string]$Grade,
  [Parameter(Mandatory=$true)][ValidatePattern('^20\d{2}-20\d{2}$')][string]$AcademicSession,
  [Parameter(Mandatory=$true)][string]$ImagePath
)
$ErrorActionPreference = 'Stop'
$routineFile = Get-Item -LiteralPath $ImagePath
$routineExtension = $routineFile.Extension.ToLowerInvariant()
if ($routineExtension -notin '.jpg','.jpeg','.png','.webp') { throw 'Use a JPG, PNG or WebP routine image.' }
if ($routineFile.Length -gt 10485760) { throw 'Routine images must be at most 10 MB.' }
$routineObject = "grade-$Grade/$AcademicSession/$([guid]::NewGuid().ToString('N'))$routineExtension"
$routineCli = Join-Path $PSScriptRoot '../node_modules/supabase/dist/supabase.js'
$routineMime = switch ($routineExtension) { '.png' { 'image/png' }; '.webp' { 'image/webp' }; default { 'image/jpeg' } }
& node (Join-Path $PSScriptRoot 'upload-routine-image.mjs') $routineFile.FullName $routineObject $routineMime
if ($LASTEXITCODE -ne 0) { throw 'Routine upload failed; no download links were changed.' }

# One original scan contains all three groups of this grade/session.
# Link only after Storage confirms the file exists. Never change other sessions.
$routineSql = @"
BEGIN;
DO `$`$
DECLARE linked_count integer;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='class-routines' AND name='$routineObject') THEN
  RAISE EXCEPTION 'Uploaded routine object is missing';
 END IF;
 UPDATE public.class_routine_settings s SET download_path='$routineObject'
 FROM public.classes c JOIN public.academic_years a ON a.id=c.academic_year_id
 WHERE s.class_id=c.id AND c.is_active AND c.grade::text='$Grade' AND a.name='$AcademicSession';
 GET DIAGNOSTICS linked_count = ROW_COUNT;
 IF linked_count <> 3 THEN RAISE EXCEPTION 'Expected exactly 3 class routines, found %',linked_count; END IF;
END;
`$`$;
COMMIT;
SELECT c.name,s.download_path FROM public.class_routine_settings s
JOIN public.classes c ON c.id=s.class_id WHERE s.download_path='$routineObject';
"@
$routineSqlFile = Join-Path ([System.IO.Path]::GetTempPath()) "routine-download-$([guid]::NewGuid().ToString('N')).sql"
try {
  [System.IO.File]::WriteAllText($routineSqlFile, $routineSql, [System.Text.UTF8Encoding]::new($false))
  & node $routineCli db query --linked --file $routineSqlFile
  if ($LASTEXITCODE -ne 0) { throw "Linking failed. Uploaded object retained at class-routines/$routineObject for retry." }
} finally {
  Remove-Item -LiteralPath $routineSqlFile -ErrorAction SilentlyContinue
}
