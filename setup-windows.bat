@echo off
echo Installing Node dependencies...
call npm install

echo.
echo Installing/updating yt-dlp with Python pip...
python -m pip install -U yt-dlp

echo.
echo Checking FFmpeg...
where ffmpeg >nul 2>nul
if %errorlevel% neq 0 (
  echo FFmpeg was not found in PATH.
  echo MP4 single-file fallback will work, but MP3 and high-quality merged video need FFmpeg.
  echo Install FFmpeg with one of these commands, then restart this app:
  echo   winget install Gyan.FFmpeg
  echo   choco install ffmpeg
) else (
  echo FFmpeg found.
)

echo.
echo Starting app at http://localhost:3000
call npm start
