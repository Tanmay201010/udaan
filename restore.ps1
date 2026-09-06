$logPath = "C:\Users\Tanmay\.gemini\antigravity\brain\b8a5fa7c-4003-47a1-8e7a-6fe224e23fad\.system_generated\logs\transcript_full.jsonl"
$workspace = "c:\Users\Tanmay\Downloads\polymarket"

function Restore-AppJS {
    Write-Host "Searching for app.js chunks..."
    $content1 = $null
    $content2 = $null
    
    $reader = [System.IO.File]::OpenText($logPath)
    try {
        while ($line = $reader.ReadLine()) {
            if ($line -like "*app.js*") {
                if ($line -like "*Showing lines 1 to 800*") {
                    $json = ConvertFrom-Json $line -ErrorAction SilentlyContinue
                    if ($json -and $json.content) { $content1 = $json.content }
                }
                if ($line -like "*Showing lines 801 to 1031*") {
                    $json = ConvertFrom-Json $line -ErrorAction SilentlyContinue
                    if ($json -and $json.content) { $content2 = $json.content }
                }
            }
        }
    } finally {
        $reader.Close()
    }
    
    if (-not $content1 -or -not $content2) {
        Write-Host "Could not find app.js chunks in logs! c1=$($content1 -ne $null), c2=$($content2 -ne $null)"
        return
    }
    
    $outputLines = New-Object System.Collections.Generic.List[string]
    
    # Process Chunk 1 (lines 1 to 800)
    $lines1 = $content1 -split "`n"
    $started = $false
    foreach ($l in $lines1) {
        $l = $l.TrimEnd("`r")
        if ($l -like "*Showing lines 1 to*") { $started = $true; continue }
        if ($started) {
            if ($l -like "*The above content shows the entire*" -or $l -like "*The above content does NOT show*") { break }
            if ($l -match "^\d+: (.*)$") { $outputLines.Add($matches[1]) }
            elseif ($l -match "^\d+:$") { $outputLines.Add("") }
        }
    }
    
    # Process Chunk 2 (lines 801 to 1031)
    $lines2 = $content2 -split "`n"
    $started = $false
    foreach ($l in $lines2) {
        $l = $l.TrimEnd("`r")
        if ($l -like "*Showing lines 801 to*") { $started = $true; continue }
        if ($started) {
            if ($l -like "*The above content shows the entire*" -or $l -like "*The above content does NOT show*") { break }
            if ($l -match "^\d+: (.*)$") { $outputLines.Add($matches[1]) }
            elseif ($l -match "^\d+:$") { $outputLines.Add("") }
        }
    }
    
    $outPath = Join-Path $workspace "app.js"
    [System.IO.File]::WriteAllLines($outPath, $outputLines)
    Write-Host "Restored app.js to $outPath ($($outputLines.Count) lines)"
}

Restore-AppJS
