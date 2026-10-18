$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$pythonPath = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $pythonPath)) {
  if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw "Python 3 is required. Install Python, then run this script again."
  }
  & py -3 -m venv .venv
  if ($LASTEXITCODE -ne 0) { throw "Could not create the PrepVerse API Python environment." }
}

& $pythonPath -c "import fastapi, uvicorn, sqlalchemy" 2>$null
if ($LASTEXITCODE -ne 0) {
  & $pythonPath -m pip install -r requirements.txt
  if ($LASTEXITCODE -ne 0) { throw "Could not install the PrepVerse API requirements." }
}

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
  $secret = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
  $envText = Get-Content (Join-Path $PSScriptRoot ".env.example") -Raw
  $envText = $envText -replace "(?m)^PREPVERSE_JWT_SECRET=.*$", "PREPVERSE_JWT_SECRET=$secret"
  [System.IO.File]::WriteAllText($envPath, $envText, [System.Text.UTF8Encoding]::new($false))
}

& $pythonPath -m uvicorn app.main:app --host 127.0.0.1 --port 8001
