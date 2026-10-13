# Generate a role-specific recording link for an actor.
# Usage: powershell -File scripts\New-RoleLink.ps1 -Role dar_matron -ActorName "Emily"
param([string]$Role = "dar_matron", [string]$ActorName = "")
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$SecretPath = Join-Path $Root ".local\invite-secret.dpapi"
if (-not (Test-Path -LiteralPath $SecretPath)) { throw "Run Connect-Storage.ps1 first." }
$SecureInvite = (Get-Content -LiteralPath $SecretPath -Raw).Trim() | ConvertTo-SecureString
$Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureInvite)
$Previous = $env:INVITE_SECRET
try {
    $env:INVITE_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
    $url = "https://voice-actor-intake.voice-intake.workers.dev/?role=$Role"
    if ($ActorName) {
        & node (Join-Path $PSScriptRoot "invite.mjs") $url $ActorName 30
    } else {
        Write-Host "`nPublic role link (no name pre-filled):" -ForegroundColor Cyan
        Write-Host "$url"
    }
} finally {
    $env:INVITE_SECRET = $Previous
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
}
