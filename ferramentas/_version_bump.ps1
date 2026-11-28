param([string]$IndexFile = "index.html")

# Usa a mesma tecnica: ler como Latin1 e escrever como UTF8 sem BOM
# para garantir que os caracteres especiais sejam preservados corretamente.
$utf8NoBom  = New-Object System.Text.UTF8Encoding $false

# Le o arquivo UTF-8 atual (ja corrigido)
$content = [System.IO.File]::ReadAllText($IndexFile, $utf8NoBom)

# Le a versao atual do badge
if ($content -match 'v(\d+)\.(\d+)\.(\d+)\s*&nbsp;') {
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    $patch = [int]$Matches[3] + 1
} else {
    Write-Error "ERRO: Padrao de versao 'vX.X.X' nao encontrado no index.html"
    exit 1
}

$newVer   = "$major.$minor.$patch"
$tz       = [System.TimeZoneInfo]::FindSystemTimeZoneById('E. South America Standard Time')
$today    = [System.TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz).ToString('dd/MM/yyyy')
$newBadge = "v$newVer &nbsp;&middot;&nbsp; $today"

# Substitui o badge de versao
$content = $content -replace 'v\d+\.\d+\.\d+\s*&nbsp;.+?\d{2}/\d{2}/\d{4}', $newBadge

# Atualiza os cache-busters (?v=...) com um codigo do CONTEUDO de cada arquivo.
# Arquivo que nao mudou mantem o mesmo endereco: o navegador so confere (304) e nao baixa de novo.
# Quebras de linha sao normalizadas, para o deploy.bat e o GitHub gerarem o mesmo codigo.
# Se o arquivo nao existir (caminho externo/errado), usa o numero da versao, como antes.
$baseDir = Split-Path -Parent ([System.IO.Path]::GetFullPath($IndexFile))
$sha     = [System.Security.Cryptography.SHA256]::Create()
$textExt = @('.js', '.css', '.html', '.json', '.svg', '.txt')
$hashCache = @{}
$avaliador = [System.Text.RegularExpressions.MatchEvaluator]{
    param($m)
    $rel = [System.Uri]::UnescapeDataString($m.Groups[2].Value)
    $full = Join-Path $baseDir ($rel -replace '/', '\')
    if (-not $hashCache.ContainsKey($full)) {
        if (Test-Path -LiteralPath $full -PathType Leaf) {
            if ($textExt -contains ([System.IO.Path]::GetExtension($full).ToLower())) {
                $txt = [System.IO.File]::ReadAllText($full, $utf8NoBom).Replace("`r", "")
                $bytes = $utf8NoBom.GetBytes($txt)
            } else {
                $bytes = [System.IO.File]::ReadAllBytes($full)
            }
            $h = ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join ''
            $hashCache[$full] = $h.Substring(0, 10)
        } else {
            $hashCache[$full] = "$patch"
        }
    }
    return $m.Groups[1].Value + $m.Groups[2].Value + '?v=' + $hashCache[$full] + '"'
}
$content = [regex]::Replace($content, '((?:src|href|data-src)=")([^"?#]+)\?v=[^"&#]*"', $avaliador)
# Qualquer outro ?v=NNN que sobrar (fora de src/href) segue o numero da versao
$content = $content -replace '\?v=\d+(?=["''&#])', "?v=$patch"

# Salva de volta como UTF-8 sem BOM - NUNCA como Latin1
[System.IO.File]::WriteAllText($IndexFile, $content, $utf8NoBom)

Write-Output $newVer
