#Requires -Version 5.1
<#
Builds the Microsoft Store package of Silk Zip into target\store.

  powershell -File scripts\build-store-msix.ps1             # build and pack the .msix
  powershell -File scripts\build-store-msix.ps1 -Register   # also install the unpacked layout (developer mode)
  powershell -File scripts\build-store-msix.ps1 -SkipBuild  # repack what is already built

The .msix is unsigned on purpose: upload it to Partner Center, the Store signs it.
#>
param(
    [switch]$Register,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$app = Join-Path $repo 'apps\silk-zip'
$store = Join-Path $app 'store'
$release = Join-Path $repo 'target\release'
$out = Join-Path $repo 'target\store'
$layout = Join-Path $out 'layout'

function Invoke-Checked([string]$what) {
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

function Find-SdkTool([string]$name) {
    $found = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.*\x64\$name" -ErrorAction SilentlyContinue |
        Sort-Object { [version]$_.Directory.Parent.Name } | Select-Object -Last 1
    if (-not $found) { throw "$name not found: install the Windows 10/11 SDK" }
    $found.FullName
}

$makeappx = Find-SdkTool 'makeappx.exe'
$makepri = Find-SdkTool 'makepri.exe'

if (-not $SkipBuild) {
    Push-Location $repo
    try {
        cargo build --release -p silk-zip-shell
        Invoke-Checked 'cargo build (shell extension)'
        pnpm --filter '@silk-studio/zip' tauri build --no-bundle
        Invoke-Checked 'tauri build'
    }
    finally { Pop-Location }
}

# An installed layout keeps these files in use; -Register installs the new one at the end.
if ($Register) { Get-AppxPackage -Name 'SilkStudio.SilkZip' | Remove-AppxPackage }
if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $layout 'Assets') | Out-Null
Copy-Item (Join-Path $release 'silk-zip.exe'), (Join-Path $release 'silk_zip_shell.dll') $layout
Copy-Item (Join-Path $store 'Strings') $layout -Recurse

# The Store does not accept a version that starts with 0, and reserves the fourth number:
# app 0.1.2 becomes 1.1.2.0, app 1.2.3 stays 1.2.3.0.
$appVersion = (Get-Content (Join-Path $app 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
$parts = [version]$appVersion
$version = '{0}.{1}.{2}.0' -f [Math]::Max($parts.Major, 1), $parts.Minor, [Math]::Max($parts.Build, 0)

[xml]$manifest = Get-Content (Join-Path $store 'AppxManifest.xml') -Raw -Encoding UTF8
$manifest.Package.Identity.Version = $version
$manifest.Save((Join-Path $layout 'AppxManifest.xml'))

# Logos, resized from the app icon. The "unplated" sizes keep the taskbar icon without a backdrop.
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile((Join-Path $app 'src-tauri\icons\128x128@2x.png'))
function Save-Logo([int]$size, [string]$name) {
    $bitmap = New-Object System.Drawing.Bitmap $size, $size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($source, 0, 0, $size, $size)
    $bitmap.Save((Join-Path $layout "Assets\$name"), [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
}
Save-Logo 50 'StoreLogo.png'
Save-Logo 150 'Square150x150Logo.png'
Save-Logo 44 'Square44x44Logo.png'
foreach ($size in 16, 24, 32, 48, 256) {
    Save-Logo $size "Square44x44Logo.targetsize-$size.png"
    Save-Logo $size "Square44x44Logo.targetsize-${size}_altform-unplated.png"
}
$source.Dispose()

# resources.pri indexes the localized names and the logo sizes.
$config = Join-Path $out 'priconfig.xml'
& $makepri createconfig /cf $config /dq en-US /o | Out-Null
Invoke-Checked 'makepri createconfig'
# Without this the default configuration splits the resources into separate packages.
[xml]$pri = Get-Content $config -Raw
$packaging = $pri.resources.SelectSingleNode('packaging')
if ($packaging) { $pri.resources.RemoveChild($packaging) | Out-Null }
$pri.Save($config)
& $makepri new /pr $layout /cf $config /mn (Join-Path $layout 'AppxManifest.xml') /of (Join-Path $layout 'resources.pri') /o | Out-Null
Invoke-Checked 'makepri new'

$package = Join-Path $out "SilkZip_${version}_x64.msix"
& $makeappx pack /d $layout /p $package /o | Out-Null
Invoke-Checked 'makeappx pack'
Write-Host "Package: $package"

if ($Register) {
    # Both would offer the same menu; the unsigned one from `--register-shell` goes first.
    Get-AppxPackage -Name 'Oopsha.SilkZip' | Remove-AppxPackage
    Add-AppxPackage -Register (Join-Path $layout 'AppxManifest.xml')
    Write-Host 'Installed from the layout folder. Remove with: Get-AppxPackage -Name SilkStudio.SilkZip | Remove-AppxPackage'
}
