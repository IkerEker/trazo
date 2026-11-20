@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
REM ==== Trazo: pasar el plugin a la casa local (ORDEN 2 de Iker) ====
REM Doble clic. No borra nada. Al final abre INFORME_CASA.txt: pegaselo a Claude.
set "B=C:\Users\ikerg\Biblioteca"
set "P=%B%\plugins\trazo"
set "R=%B%\plugins\_respaldos"
set "URL=https://github.com/IkerEker/trazo.git"
if not exist "%B%\TEXTURAS" ( echo No encuentro %B%\TEXTURAS & pause & exit /b 1 )
where git >nul 2>nul || ( echo Falta git & pause & exit /b 1 )
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY ( where python >nul 2>nul && set "PY=python" )
if not defined PY ( echo Falta Python 3 ^(https://www.python.org^) & pause & exit /b 1 )

echo [1/6] Actualizando la biblioteca (TEXTURAS, rama atlas)...
git -C "%B%\TEXTURAS" pull origin atlas || ( echo No se pudo actualizar TEXTURAS & pause & exit /b 1 )

echo [2/6] Clonando todo el repo en la casa nueva...
if not exist "%B%\plugins" mkdir "%B%\plugins"
if exist "%P%\.git" (
  echo   Ya existe %P%: solo se actualiza.
) else (
  git clone --no-single-branch "%URL%" "%P%" || ( echo Fallo el clon & pause & exit /b 1 )
)
cd /d "%P%"
git fetch --all --tags
git checkout -q biblioteca || ( echo No encuentro la rama biblioteca & pause & exit /b 1 )

echo [3/6] Copia de seguridad del historial (bundle)...
if not exist "%R%" mkdir "%R%"
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "D=%%d"
git bundle create "%R%\trazo_%D%.bundle" --all || ( echo Fallo el bundle & pause & exit /b 1 )
git bundle verify "%R%\trazo_%D%.bundle"
REM guardar solo los 3 ultimos bundles de trazo
for /f "skip=3 delims=" %%f in ('dir /b /o-d "%R%\trazo_*.bundle"') do del "%R%\%%f"

echo [4/6] Dependencias de construccion (numpy, scipy, Pillow)...
%PY% -c "import numpy, scipy, PIL" 2>nul || %PY% -m pip install --user numpy scipy pillow

echo [5/6] Comprobaciones, construccion desde la biblioteca y prueba exacta (tarda unos minutos)...
%PY% tools\casa_local.py --biblioteca "%B%" --bundle "%R%\trazo_%D%.bundle"

echo [6/6] Listo.
start "" notepad "%P%\INFORME_CASA.txt"
pause
