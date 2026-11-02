param([Parameter(Mandatory=$true)][string]$VsixPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$archivePath = (Resolve-Path -LiteralPath $VsixPath).Path
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $count = 0
    foreach ($entry in $archive.Entries) {
        $name = $entry.FullName.Replace('\', '/')
        if (-not ($name.StartsWith('extension/resources/voices/', [StringComparison]::Ordinal) -or
                  $name.StartsWith('extension/resources/runtime/', [StringComparison]::Ordinal) -or
                  $name.StartsWith('extension/resources/ai/', [StringComparison]::Ordinal) -or
                  $name -eq 'extension/resources/bundled-voices.json')) { continue }
        $relative = $name.Substring('extension/'.Length)
        $target = [IO.Path]::GetFullPath((Join-Path $project $relative))
        if (-not $target.StartsWith($project + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Unsafe archive path: $name"
        }
        if ($name.EndsWith('/')) { continue }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
        $count++
    }
    if ($count -eq 0) { throw 'This VSIX contains no offline voice/runtime assets.' }
    Write-Host "Imported $count offline asset files. The build will verify their checksums."
} finally { $archive.Dispose() }
