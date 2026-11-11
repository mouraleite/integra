@echo off
setlocal enabledelayedexpansion

echo.
echo ========================================================
echo   DEPLOY AUTOMATICO - CRM MOURA LEITE
echo ========================================================
echo.

REM --- 0) TRAZ O QUE OUTRAS PESSOAS SUBIRAM NO GITHUB ---
echo [0/5] Buscando alteracoes de outras pessoas no GitHub...
git pull --no-rebase --no-edit --autostash origin main
if errorlevel 1 goto :conflito
for /f %%f in ('git diff --name-only --diff-filter=U') do goto :conflito
echo       OK - Pasta atualizada com o GitHub
echo.

REM --- 1) INCREMENTA VERSAO NO INDEX.HTML ---
echo [1/5] Incrementando versao no index.html...
for /f "tokens=*" %%v in ('powershell -NoProfile -ExecutionPolicy Bypass -File "_version_bump.ps1"') do set NEW_VER=%%v

if "!NEW_VER!"=="" (
    echo.
    echo [ERRO] Nao foi possivel ler a versao do index.html.
    echo        Verifique se _version_bump.ps1 esta na mesma pasta.
    pause
    exit /b 1
)

for /f "tokens=*" %%d in ('powershell -NoProfile -Command "Get-Date -Format 'dd/MM/yyyy'"') do set TODAY=%%d

echo       OK - Nova versao: v!NEW_VER! (!TODAY!)
echo.

REM --- 2) GIT ADD + COMMIT ---
echo [2/5] Registrando alteracoes no Git...
if exist "assets\pets" (
    echo       Incluindo todos os arquivos novos da pasta assets\pets...
    git add "assets/pets"
)
git add .
git commit -m "v!NEW_VER! - !TODAY!"
echo       OK - Commit criado
echo.

REM --- 3) CRIA TAG LOCAL ---
echo [3/5] Criando tag v!NEW_VER! no repositorio local...
git tag -a "v!NEW_VER!" -m "Versao !NEW_VER! - !TODAY!"
echo       OK - Tag v!NEW_VER! criada
echo.

REM --- 4) ENVIA COMMITS PARA O GITHUB ---
echo [4/5] Enviando commits para o GitHub...
git push
if errorlevel 1 (
    echo.
    echo [ERRO] O GitHub recusou o envio. Nada foi publicado na Vercel.
    echo        Provavelmente alguem subiu algo nos ultimos segundos. Rode o deploy de novo.
    pause
    exit /b 1
)
echo       OK - Commits enviados
echo.

REM --- 5) ENVIA TAGS PARA O GITHUB ---
echo [5/5] Enviando tags para o GitHub...
git push --tags
echo       OK - Tags enviadas
echo.
REM --- 6) ATUALIZA O AMBIENTE DE TESTE (branch develop) ---
REM So avanca a develop; se a Danielle tiver algo la que ainda nao entrou na main, nao mexe.
echo [6/6] Atualizando o ambiente de teste (develop)...
git push origin main:develop >nul 2>&1
if errorlevel 1 (
    echo       AVISO - A develop tem alteracoes que ainda nao estao na main.
    echo                O ambiente de teste NAO foi atualizado. Peca ao Claude: "juntar develop na main".
) else (
    echo       OK - Ambiente de teste igual a producao
)
echo.

echo ========================================================
echo   SUCESSO! v!NEW_VER! publicada no GitHub e Vercel
echo.
echo   Ver versoes: seu repositorio GitHub - Tags
echo   Aguarde ~30s e atualize a pagina do CRM.
echo ========================================================
echo.
pause
exit /b 0

:conflito
echo.
echo [PARADO] Suas alteracoes e as que vieram do GitHub mexem nas mesmas linhas.
echo          Nada foi enviado. Peca ao Claude: "resolver conflito do deploy".
pause
exit /b 1
