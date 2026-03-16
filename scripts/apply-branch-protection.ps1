param(
  [Parameter(Mandatory = $true)]
  [string]$Owner,
  [Parameter(Mandatory = $true)]
  [string]$Repo,
  [string]$Branch = "master"
)

# Requires GitHub CLI authenticated with repo admin permissions.
$payloadPath = Join-Path $PSScriptRoot "branch-protection.json"
if (-not (Test-Path $payloadPath)) {
  throw "Missing payload file: $payloadPath"
}

$payload = Get-Content $payloadPath -Raw
$endpoint = "repos/$Owner/$Repo/branches/$Branch/protection"

gh api --method PUT --header "Accept: application/vnd.github+json" $endpoint --input $payloadPath
if ($LASTEXITCODE -ne 0) {
  throw "Failed to apply branch protection."
}

Write-Host "Branch protection applied for $Owner/$Repo on branch '$Branch'."
