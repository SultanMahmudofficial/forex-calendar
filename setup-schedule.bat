@echo off
REM setup-schedule.bat — registers a Windows scheduled task that runs update-news.ps1
REM every 12 hours (6:30 AM and 6:30 PM) so the calendar stays fresh.
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%update-news.ps1"

powershell -NoProfile -Command ^
  "$p = '%PS1%';" ^
  "$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"' + $p + '\"');" ^
  "$trigger = New-ScheduledTaskTrigger -Daily -At 06:30;" ^
  "$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable;" ^
  "Register-ScheduledTask -TaskName 'ForexCalendarUpdate' -Action $action -Trigger $trigger -Settings $settings -Force"

if %errorlevel% neq 0 (
  echo.
  echo Failed to create the scheduled task. You may need to run this as Administrator.
  echo Alternative: create the task in Task Scheduler manually, or keep this window open.
  exit /b 1
)

echo.
echo Scheduled task "ForexCalendarUpdate" created.
echo It will run update-news.ps1 every 12 hours (06:30 and 18:30).
echo Note: the task only runs while this PC is on and awake.
pause
