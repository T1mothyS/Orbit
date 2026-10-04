param(
  [Parameter(Mandatory)][string]$HtmlPath,
  [switch]$BridgeHtml
)
# Uses only the browser's synthetic clipboard fixture and a new hidden document.
# -BridgeHtml tests Word's HTML import separately when headless Chromium has no OS clipboard.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$fixtureHtml = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $HtmlPath).Path)
if (-not $fixtureHtml.Contains('图文第一段') -or -not $fixtureHtml.Contains('data:image/png;base64,')) { throw 'Only the synthetic browser fixture is accepted' }
$transport = 'browser-os-clipboard'
if ($BridgeHtml) {
  $transport = 'synthetic-CF_HTML-bridge'
  $fragment = '<html><body><!--StartFragment-->' + $fixtureHtml + '<!--EndFragment--></body></html>'
  $template = "Version:1.0`r`nStartHTML:{0:D10}`r`nEndHTML:{1:D10}`r`nStartFragment:{2:D10}`r`nEndFragment:{3:D10}`r`n"
  $headerLength = [Text.Encoding]::UTF8.GetByteCount(($template -f 0,0,0,0))
  $start = $headerLength + [Text.Encoding]::UTF8.GetByteCount('<html><body><!--StartFragment-->')
  $end = $start + [Text.Encoding]::UTF8.GetByteCount($fixtureHtml)
  $clipboardData = [Windows.Forms.DataObject]::new()
  $clipboardData.SetData([Windows.Forms.DataFormats]::Html, ($template -f $headerLength,($headerLength+[Text.Encoding]::UTF8.GetByteCount($fragment)),$start,$end) + $fragment)
  $clipboardData.SetText("图文第一段`r`n`r`n图文第二段")
  [Windows.Forms.Clipboard]::SetDataObject($clipboardData,$true)
}
$clipboardHtml = [Windows.Forms.Clipboard]::GetText([Windows.Forms.TextDataFormat]::Html)
if (-not $clipboardHtml.Contains('图文第一段')) {
  @{ status='UNAVAILABLE'; transport=$transport; reason='Browser synthetic HTML is not on the Windows OS clipboard'; } | ConvertTo-Json -Compress
  exit 0
}
$word = $null; $document = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false; $word.DisplayAlerts = 0; $word.AutomationSecurity = 3
  $document = $word.Documents.Add()
  $document.Content.Paste()
  $validText = $document.Content.Text.Contains('图文第一段') -and $document.Content.Text.Contains('图文第二段')
  $positions = @(); for ($index=1; $index -le $document.InlineShapes.Count; $index++) { $positions += $document.InlineShapes.Item($index).Range.Start }
  $result = @{ status= $(if($validText -and $document.InlineShapes.Count -eq 2){'PASSED'}else{'FAILED'}); transport=$transport; wordVersion=$word.Version; hasText=$validText; images=$document.InlineShapes.Count; positions=$positions }
  if ($result.status -eq 'PASSED') { $document.SaveAs2((Join-Path (Split-Path -Parent (Resolve-Path -LiteralPath $HtmlPath).Path) 'word-paste.docx'),16) }
  $result | ConvertTo-Json -Compress
} finally {
  if ($null -ne $document) { $document.Close(0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) }
  if ($null -ne $word) { $word.Quit(0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) }
}
