@echo off
chcp 65001 >nul
echo [Hakimi Mod Kit] 正在执行便携底座一键重铸...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0repatch.ps1" %*
if %ERRORLEVEL% equ 0 (
    echo [Hakimi Mod Kit] 重铸成功完成！
) else (
    echo [Hakimi Mod Kit] 重铸出现异常，错误码: %ERRORLEVEL%
)
pause
