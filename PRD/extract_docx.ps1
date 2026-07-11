Add-Type -Assembly System.IO.Compression.FileSystem
$docxPath = "C:\Users\aditya\Documents\DEVELOPMENT\Websites\Stock Market\PRD\Chakravyuh Trading Game - Developer Handover (v5).docx"
$outPath = "C:\Users\aditya\Documents\DEVELOPMENT\Websites\Stock Market\PRD\handover_text.txt"
$tempCopy = [System.IO.Path]::GetTempFileName() + ".docx"
Copy-Item $docxPath $tempCopy -Force
$zip = [IO.Compression.ZipFile]::OpenRead($tempCopy)
$entry = $zip.Entries | Where-Object { $_.FullName -eq "word/document.xml" }
$stream = $entry.Open()
$reader = New-Object IO.StreamReader($stream)
$xml = $reader.ReadToEnd()
$reader.Close()
$zip.Dispose()
Remove-Item $tempCopy -Force
# Strip XML tags leaving just text
$text = [System.Text.RegularExpressions.Regex]::Replace($xml, '<[^>]+>', ' ')
# Collapse multiple spaces/newlines
$text = [System.Text.RegularExpressions.Regex]::Replace($text, '\s+', ' ')
$text | Out-File -Encoding utf8 $outPath
Write-Host "Done - extracted to handover_text.txt"
