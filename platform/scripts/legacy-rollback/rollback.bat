@echo off
rem AGM-PLUGIN-01 rollback. Args: [-VerifyOnly] [-ChainStability03]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rollback.ps1" %*
exit /b %errorlevel%
