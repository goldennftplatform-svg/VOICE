$ErrorActionPreference = 'Stop'
$Lines = @(& (Join-Path $PSScriptRoot 'Make-Voice-Links.ps1'))
$Links = @($Lines | Where-Object { $_ -is [string] -and $_.StartsWith('https://voice-actor-intake.voice-intake.workers.dev/library.html#review=') })
if ($Links.Count -ne 1) { throw 'Could not generate a private review link. Check the encrypted invitation secret setup.' }
Start-Process $Links[0]
Write-Host 'Opened Voice Admin with a fresh private review link. This link is valid for 7 days.'
