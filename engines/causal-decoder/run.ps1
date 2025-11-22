$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$session.UserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"

Invoke-WebRequest -UseBasicParsing `
  -Uri "http://localhost:3000/api/v1/engines/causal-decoder/generate" `
  -Method "POST" `
  -WebSession $session `
  -Headers @{
    "Accept" = "application/json, text/plain, */*"
  } `
  -ContentType "application/json" `
  -Body (@{
      prompt = "More global warming causes more ice caps to melt."
      currentModel = @{
        variables = @()
        relationships = @()
      }
  } | ConvertTo-Json -Depth 5)
