@echo off
title Registro de acessos - Einstein 29
cd /d "%~dp0"
echo Iniciando o registro de acessos...
echo Deixe esta janela aberta enquanto a proposta estiver em uso.
echo.
node registro-server.mjs
pause
