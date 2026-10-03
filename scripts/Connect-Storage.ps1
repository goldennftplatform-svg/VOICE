$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
Write-Host "Connect VOICE to its private GitHub recording repository."
Write-Host "Create a fine-grained token for VOICE-samples ONLY, with Contents: Read and write."
Write-Host "Paste the token below. It will be hidden and sent only to GitHub (validation) and Cloudflare (storage secret)."
$SecureToken = Read-Host "GitHub token" -AsSecureString
$Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
try {
    $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
    $Repo = Invoke-RestMethod -Uri "https://api.github.com/repos/goldennftplatform-svg/VOICE-samples" -Headers @{ Authorization = "Bearer $Token"; Accept = "application/vnd.github+json"; "User-Agent" = "VOICE-setup" }
    if (-not $Repo.private) { throw "The recording repository must be private." }
    $Token | & npx.cmd wrangler secret put GITHUB_TOKEN
    if ($LASTEXITCODE -ne 0) { throw "Cloudflare could not save the GitHub token." }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
    $Token = $null
}
$Local = Join-Path $Root ".local"
$SecretPath = Join-Path $Local "invite-secret.dpapi"
if (Test-Path -LiteralPath $SecretPath) {
    $SecureInvite = (Get-Content -LiteralPath $SecretPath -Raw).Trim() | ConvertTo-SecureString
} else {
    $Bytes = New-Object byte[] 32
    $Generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $Generator.GetBytes($Bytes) } finally { $Generator.Dispose() }
    $SecureInvite = ConvertTo-SecureString ([Convert]::ToBase64String($Bytes)) -AsPlainText -Force
    New-Item -ItemType Directory -Path $Local -Force | Out-Null
    $SecureInvite | ConvertFrom-SecureString | Set-Content -LiteralPath $SecretPath
}
$Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureInvite)
try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) | & npx.cmd wrangler secret put INVITE_SECRET
    if ($LASTEXITCODE -ne 0) { throw "Cloudflare could not save the invitation secret. Re-run this script to retry." }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
}
Write-Host "Storage secrets configured. Your invitation secret is encrypted for this Windows user under .local/."
Write-Host "Next: run scripts\Make-Voice-Links.ps1 to create actor and team review links."
Read-Host "Press Enter to close"
