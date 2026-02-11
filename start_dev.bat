@echo off
REM Set up full MSVC build environment
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64

REM Set LLVM/Clang paths
set LIBCLANG_PATH=C:\Program Files\LLVM\lib
set CMAKE_GENERATOR=Visual Studio 17 2022
set PATH=C:\Program Files\CMake\bin;C:\Program Files\LLVM\bin;%PATH%

REM Navigate to project
cd /d C:\Users\hamsi\ses123\fisilti

REM Enable logging
set RUST_LOG=info

REM Start Tauri dev (minimized terminal)
if "%1"=="--hidden" (
    npm run tauri dev > C:\Users\hamsi\ses123\fisilti\dev_output.log 2>&1
    echo %ERRORLEVEL% > C:\Users\hamsi\ses123\fisilti\dev_exitcode.txt
) else (
    start /min "" cmd /c "%~f0" --hidden
    exit
)
