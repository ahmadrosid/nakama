$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $IsWindows -or [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw 'Build the Store package on Windows x64 with PowerShell 7.'
}

# Copy these values exactly from Partner Center > Product identity.
$identity = $env:WINDOWS_STORE_IDENTITY_NAME
$publisher = $env:WINDOWS_STORE_PUBLISHER
$publisherName = $env:WINDOWS_STORE_PUBLISHER_DISPLAY_NAME
$displayName = $env:WINDOWS_STORE_DISPLAY_NAME
if ($identity -notmatch '^[a-zA-Z0-9.-]{3,50}$' -or
    $publisher -notmatch '^CN=.+$' -or
    [string]::IsNullOrWhiteSpace($publisherName) -or
    [string]::IsNullOrWhiteSpace($displayName)) {
    throw 'Set WINDOWS_STORE_IDENTITY_NAME, WINDOWS_STORE_PUBLISHER, WINDOWS_STORE_PUBLISHER_DISPLAY_NAME, and WINDOWS_STORE_DISPLAY_NAME from Partner Center.'
}

Push-Location (Join-Path $PSScriptRoot '..')
try {
    $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
    if ($version -notmatch '^\d+\.\d+\.\d+$' -or
        @($version.Split('.') | Where-Object { [int]$_ -gt 65535 }).Count -gt 0) {
        throw 'Store builds require a stable three-part version with components <= 65535.'
    }

    & bun run build:runtime
    if ($LASTEXITCODE -ne 0) { throw 'Runtime build failed.' }

    # Supply all required tile assets instead of electron-builder's default logos.
    $resources = Join-Path $PWD 'dist/store-resources'
    $assets = Join-Path $resources 'appx'
    New-Item -ItemType Directory -Force $assets | Out-Null
    Add-Type -AssemblyName System.Drawing
    $icon = [System.Drawing.Image]::FromFile((Join-Path $PWD '../web/public/icons/icon-512.png'))
    try {
        foreach ($asset in @(
            @('StoreLogo.png', 50, 50),
            @('Square44x44Logo.png', 44, 44),
            @('Square150x150Logo.png', 150, 150),
            @('Wide310x150Logo.png', 310, 150)
        )) {
            $bitmap = [System.Drawing.Bitmap]::new($asset[1], $asset[2])
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $size = [Math]::Min($asset[1], $asset[2])
                $graphics.DrawImage($icon, [int](($asset[1] - $size) / 2), 0, $size, $size)
                $bitmap.Save((Join-Path $assets $asset[0]), [System.Drawing.Imaging.ImageFormat]::Png)
            } finally {
                $graphics.Dispose()
                $bitmap.Dispose()
            }
        }
    } finally {
        $icon.Dispose()
    }

    # The pinned builder exposes MakeAppx through its appx target. MakeAppx supports
    # .msix output with the same manifest; no beta builder upgrade is required.
    $config = @{
        extends = (Join-Path $PWD 'electron-builder.yml')
        directories = @{ buildResources = $resources }
        publish = $null
        win = @{
            target = @(@{ target = 'appx'; arch = @('x64') })
            icon = '../web/public/icons/icon-512.png'
        }
        appx = @{
            artifactName = 'Nakama-${version}-${arch}.msix'
            applicationId = 'Nakama'
            identityName = $identity
            publisher = $publisher
            publisherDisplayName = $publisherName
            displayName = $displayName
            minVersion = '10.0.19041.0'
            setBuildNumber = $false
            capabilities = @('runFullTrust', 'internetClient')
        }
    }
    $configPath = Join-Path $PWD 'dist/store-builder.json'
    $config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding utf8
    & bun x electron-builder --win --x64 --publish never --config $configPath
    if ($LASTEXITCODE -ne 0) { throw 'MSIX packaging failed.' }
    Write-Host "Unsigned Store upload: dist/electron/Nakama-$version-x64.msix"
} finally {
    Pop-Location
}
