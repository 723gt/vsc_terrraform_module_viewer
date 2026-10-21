# Build a .vsix without vsce (works with old Node). Usage: powershell -ExecutionPolicy Bypass -File scripts/build-vsix.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$out = Join-Path $root ("{0}-{1}.vsix" -f $pkg.name, $pkg.version)

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="$($pkg.name)" Version="$($pkg.version)" Publisher="$($pkg.publisher)" />
    <DisplayName>$($pkg.displayName)</DisplayName>
    <Description xml:space="preserve">$([Security.SecurityElement]::Escape($pkg.description))</Description>
    <Categories>$($pkg.categories -join ',')</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$($pkg.engines.vscode)" />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
"@

$contentTypes = @'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".css" ContentType="text/css" />
  <Default Extension=".md" ContentType="text/markdown" />
</Types>
'@

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
if (Test-Path $out) { Remove-Item $out }
$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  foreach ($e in @(@('[Content_Types].xml', $contentTypes), @('extension.vsixmanifest', $manifest))) {
    $w = New-Object System.IO.StreamWriter($zip.CreateEntry($e[0]).Open(), $utf8)
    $w.Write($e[1]); $w.Close()
  }
  $files = @('package.json', 'README.md', 'LICENSE') + (Get-ChildItem (Join-Path $root 'src'), (Join-Path $root 'media') -File | ForEach-Object { $_.FullName.Substring($root.Length + 1) })
  foreach ($f in $files) {
    # Zip entry paths must use "/" (PS 5.1 Compress-Archive writes backslashes, which VS Code cannot read)
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $root $f), 'extension/' + $f.Replace([char]92, [char]47))
  }
} finally {
  $zip.Dispose()
}
Write-Host "Created: $out"
