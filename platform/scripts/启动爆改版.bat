@echo off
setlocal EnableExtensions
set "AGM_HOME=%~dp0"
set "AGM_DBG="
if defined AGM_DEBUG_PORT if not "%AGM_DEBUG_PORT%"=="" set "AGM_DBG=--remote-debugging-port=%AGM_DEBUG_PORT%"
set "AGM_ARGS="
:agm_parse
if "%~1"=="" goto agm_launch
if /I not "%~1"=="--debug-port" goto agm_append
if "%~2"=="" (
  echo [AGM] --debug-port requires a port number.
  exit /b 1
)
set "AGM_DBG=--remote-debugging-port=%~2"
shift /1
shift /1
goto agm_parse
:agm_append
set AGM_ARGS=%AGM_ARGS% %1
shift /1
goto agm_parse
:agm_launch
start "" "%AGM_HOME%Antigravity.exe" --user-data-dir="%AGM_HOME%UserData" %AGM_DBG% %AGM_ARGS%
