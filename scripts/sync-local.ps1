param([string]$VoiceAgentRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
$ErrorActionPreference = "Stop"
$Python = Join-Path $VoiceAgentRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) { $Python = "python" }
& $Python (Join-Path $PSScriptRoot "voice_library.py") --root $VoiceAgentRoot sync
exit $LASTEXITCODE
