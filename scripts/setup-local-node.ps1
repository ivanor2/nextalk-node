# ==============================================================================
# NexTalk Node.js Local Installer (Windows PowerShell)
# Автоматическая загрузка и распаковка портативного Node.js в папку проекта
# ==============================================================================

[CmdletBinding()]
param(
    [string]$TargetDir = "",
    [string]$Version = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# Загружаем настройки из .env если параметры не переданы
if (-not $Version -or -not $TargetDir) {
    $envFile = Join-Path $ProjectRoot ".env"
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith("#")) {
                $parts = $line.Split("=", 2)
                if ($parts.Length -eq 2) {
                    $key = $parts[0].Trim()
                    $val = $parts[1].Trim().Trim('"').Trim("'")
                    if ($key -eq "NODE_VERSION" -and -not $Version) { $Version = $val }
                    if ($key -eq "LOCAL_NODE_DIR" -and -not $TargetDir) { $TargetDir = $val }
                }
            }
        }
    }
}

if (-not $Version) {
    $Version = "v22.13.0"
}
$Version = $Version.Trim()
if (-not $Version.StartsWith("v")) {
    $Version = "v$Version"
}

if (-not $TargetDir) {
    $TargetDir = Join-Path $ProjectRoot ".node"
} elseif (-not [System.IO.Path]::IsPathRooted($TargetDir)) {
    $TargetDir = Join-Path $ProjectRoot $TargetDir
}

$NodeExe = Join-Path $TargetDir "node.exe"

if ((Test-Path $NodeExe) -and (-not $Force)) {
    $currentVer = & $NodeExe -v 2>$null
    Write-Host " [INFO] Локальный Node.js уже установлен: $currentVer ($NodeExe)" -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host " ========================================================" -ForegroundColor Cyan
Write-Host "   Загрузка портативного Node.js $Version" -ForegroundColor Cyan
Write-Host "   Целевая папка: $TargetDir" -ForegroundColor Cyan
Write-Host " ========================================================" -ForegroundColor Cyan
Write-Host ""

# Определение архитектуры
$arch = "win-x64"
if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64") {
    $arch = "win-arm64"
} elseif (-not [Environment]::Is64BitOperatingSystem) {
    $arch = "win-x86"
}

$distName = "node-$Version-$arch"
$zipUrl = "https://nodejs.org/dist/$Version/$distName.zip"
$zipFile = Join-Path $ProjectRoot "node_temp_download.zip"
$tmpExtractDir = Join-Path $ProjectRoot ".node_extract_tmp"

try {
    Write-Host " [1/3] Скачивание $zipUrl..." -ForegroundColor Yellow

    $downloadOk = $false
    $curlExe = Get-Command "curl.exe" -ErrorAction SilentlyContinue

    if ($curlExe) {
        & $curlExe.Source -fSL --progress-bar $zipUrl -o $zipFile
        if ($LASTEXITCODE -eq 0 -and (Test-Path $zipFile) -and ((Get-Item $zipFile).Length -gt 1048576)) {
            $downloadOk = $true
        }
    }

    if (-not $downloadOk) {
        Write-Host " Скачивание через .NET WebClient..." -ForegroundColor Gray
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $webClient = New-Object System.Net.WebClient
        $webClient.DownloadFile($zipUrl, $zipFile)
        if ((Test-Path $zipFile) -and ((Get-Item $zipFile).Length -gt 1048576)) {
            $downloadOk = $true
        }
    }

    if (-not (Test-Path $zipFile) -or ((Get-Item $zipFile).Length -lt 1048576)) {
        throw "Не удалось скачать архив Node.js с $zipUrl"
    }

    Write-Host " [2/3] Распаковка архива..." -ForegroundColor Yellow

    if (Test-Path $tmpExtractDir) {
        Remove-Item -Recurse -Force $tmpExtractDir -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path $tmpExtractDir -Force | Out-Null

    $extracted = $false
    $tarExe = Get-Command "tar.exe" -ErrorAction SilentlyContinue
    if ($tarExe) {
        try {
            & $tarExe.Source -xf $zipFile -C $tmpExtractDir 2>$null
            if ($LASTEXITCODE -eq 0 -and (Get-ChildItem -Path $tmpExtractDir).Count -gt 0) {
                $extracted = $true
            }
        } catch {
            $extracted = $false
        }
    }

    if (-not $extracted) {
        Write-Host " Распаковка через Expand-Archive..." -ForegroundColor Gray
        Expand-Archive -Path $zipFile -DestinationPath $tmpExtractDir -Force
    }

    $extractedInner = Join-Path $tmpExtractDir $distName
    if (-not (Test-Path $extractedInner)) {
        $found = Get-ChildItem -Directory -Path $tmpExtractDir | Select-Object -First 1
        if ($found) {
            $extractedInner = $found.FullName
        } else {
            $extractedInner = $tmpExtractDir
        }
    }

    Write-Host " [3/3] Перемещение файлов в $TargetDir..." -ForegroundColor Yellow

    if (-not (Test-Path $TargetDir)) {
        New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    }

    Get-ChildItem -Path $extractedInner | ForEach-Object {
        $dest = Join-Path $TargetDir $_.Name
        if (Test-Path $dest) {
            Remove-Item -Recurse -Force $dest -ErrorAction SilentlyContinue
        }
        Move-Item -Path $_.FullName -Destination $TargetDir -Force
    }

    if (-not (Test-Path $NodeExe)) {
        throw "Ошибка: $NodeExe не найден после распаковки!"
    }

    $installedVer = & $NodeExe -v
    Write-Host ""
    Write-Host " [SUCCESS] Локальный Node.js успешно установлен: $installedVer" -ForegroundColor Green
    Write-Host " Расположение: $NodeExe" -ForegroundColor Green
    Write-Host ""
}
finally {
    # Очистка временных файлов
    if (Test-Path $tmpExtractDir) {
        Remove-Item -Recurse -Force $tmpExtractDir -ErrorAction SilentlyContinue
    }
    if (Test-Path $zipFile) {
        Remove-Item -Force $zipFile -ErrorAction SilentlyContinue
    }
}
