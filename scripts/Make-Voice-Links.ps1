param([string]$ActorName = "", [string]$Website = "https://voice-actor-intake.voice-intake.workers.dev")
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$SecretPath = Join-Path $Root ".local\invite-secret.dpapi"
if (-not (Test-Path -LiteralPath $SecretPath)) { throw "Run Connect-Storage.ps1 first." }
$SecureInvite = (Get-Content -LiteralPath $SecretPath -Raw).Trim() | ConvertTo-SecureString
$Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureInvite)
$Previous = $env:INVITE_SECRET
try {
    $env:INVITE_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
    if ($ActorName) {
        & node (Join-Path $PSScriptRoot "invite.mjs") $Website $ActorName 30
    } else {
        & node (Join-Path $PSScriptRoot "review-link.mjs") $Website 7
    }
    if ($LASTEXITCODE -ne 0) { throw "Could not generate the link." }
} finally {
    $env:INVITE_SECRET = $Previous
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
}
