# Windows code signing hook (docs/DESKTOP.md "Windows code signing later"). Called by Tauri
# (bundle.windows.signCommand) for the app binary, the NSIS installer and the MSI — only when
# the repository secret WINDOWS_SIGN_MODE is set. Usage: windows-sign.ps1 <file>
#   WINDOWS_SIGN_MODE=pfx    WINDOWS_CERT_PFX (base64 of the .pfx), WINDOWS_CERT_PASSWORD
#   WINDOWS_SIGN_MODE=azure  AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET,
#                            AZURE_SIGNING_ENDPOINT, AZURE_SIGNING_ACCOUNT, AZURE_SIGNING_PROFILE
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = 'Stop'

function Find-SignTool {
  $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  $tool = Get-ChildItem $kits -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $tool) { throw 'signtool.exe not found' }
  return $tool.FullName
}

$signtool = Find-SignTool
switch ($env:WINDOWS_SIGN_MODE) {
  'pfx' {
    $pfx = Join-Path $env:RUNNER_TEMP 'codesign.pfx'
    if (-not (Test-Path $pfx)) { [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_CERT_PFX)) }
    & $signtool sign /fd SHA256 /f $pfx /p $env:WINDOWS_CERT_PASSWORD /tr http://timestamp.digicert.com /td SHA256 /d Linkwache $File
  }
  'azure' {
    $dir = Join-Path $env:RUNNER_TEMP 'trusted-signing'
    if (-not (Test-Path $dir)) {
      nuget install Microsoft.Trusted.Signing.Client -ExcludeVersion -OutputDirectory $dir | Out-Null
      @{ Endpoint = $env:AZURE_SIGNING_ENDPOINT; CodeSigningAccountName = $env:AZURE_SIGNING_ACCOUNT; CertificateProfileName = $env:AZURE_SIGNING_PROFILE } |
        ConvertTo-Json | Set-Content (Join-Path $dir 'metadata.json') -Encoding utf8
    }
    $dlib = Join-Path $dir 'Microsoft.Trusted.Signing.Client\bin\x64\Azure.CodeSigning.Dlib.dll'
    & $signtool sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib $dlib /dmdf (Join-Path $dir 'metadata.json') $File
  }
  default { throw "unknown WINDOWS_SIGN_MODE '$env:WINDOWS_SIGN_MODE' (pfx or azure)" }
}
if ($LASTEXITCODE -ne 0) { throw "signtool failed for $File" }
