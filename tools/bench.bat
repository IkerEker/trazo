@echo off
REM Trazo - banco de pruebas: mide las 29 variantes y compara con la referencia.
REM Necesita Node.js (https://nodejs.org). Resultado en tools\bench_out\bench_<fecha>.json
cd /d "%~dp0.."
node tools\bench.js --check %*
pause
