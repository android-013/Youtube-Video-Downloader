````markdown
# YouTube Downloader Node Web

A modern web-based YouTube downloader interface rebuilt with a **Node.js backend** and a plain **HTML/CSS/JavaScript frontend**.

The app uses `yt-dlp` for video information and downloading. FFmpeg is optional but recommended for MP3 conversion and highest-quality video/audio merging.

> Use this app only for content you own, public-domain videos, or videos you have permission to download.

---

## Features

- Modern dark gradient UI
- Responsive frontend design
- Animated cards, buttons, and modals
- Single video download support
- Multiple job list interface
- Real-time job status updates
- Retry, cancel, delete, and download actions
- MP4, WebM, and MP3 format options
- Demo mode for frontend preview
- Backend error details for failed downloads

---

## Project Structure

```text
project-folder/
├── server.js
├── package.json
├── README.md
├── setup-windows.bat
├── start-demo.bat
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── downloads/
````

`downloads/` is created automatically when files are downloaded.

---

## Requirements

Install these first:

* Node.js
* npm
* Python
* yt-dlp
* FFmpeg recommended

---

## Installation

Open the project folder in terminal and run:

```bash
npm install
```

Install or update `yt-dlp`:

```bash
python -m pip install -U yt-dlp
```

---

## Run the App

Start the server:

```bash
npm start
```

Then open this in your browser:

```text
http://localhost:3000
```

---

## Windows Setup

You can run the included setup file:

```text
setup-windows.bat
```

Or install manually:

```bash
npm install
python -m pip install -U yt-dlp
npm start
```

---

## Install FFmpeg

FFmpeg is needed for:

* MP3 conversion
* Best quality video/audio merging
* Some format conversions

On Windows, install FFmpeg using:

```bash
winget install Gyan.FFmpeg
```

Or using Chocolatey:

```bash
choco install ffmpeg
```

After installing FFmpeg, close and reopen the terminal, then run:

```bash
npm start
```

---

## Demo Mode

Demo mode lets you preview the frontend without downloading real videos.

Run:

```bash
npm run demo
```

Or:

```bash
node server.js --demo
```

You can also double-click:

```text
start-demo.bat
```

---

## Environment Variables

Use a custom port:

```bash
PORT=4000 npm start
```

Enable demo mode:

```bash
DEMO_MODE=1 npm start
```

Use a custom yt-dlp path:

```bash
YTDLP_PATH=/path/to/yt-dlp npm start
```

Use browser cookies for restricted videos:

```bash
YTDLP_COOKIES_FROM_BROWSER=chrome npm start
```

Use a cookies file:

```bash
YTDLP_COOKIES_FILE=/path/to/cookies.txt npm start
```

---

## Common Problems and Fixes

### Download shows Failed

Click **Failed — details** in the app to see the exact backend error.

Most common fixes:

```bash
python -m pip install -U yt-dlp
```

Then restart:

```bash
npm start
```

---

### MP3 does not work

MP3 requires FFmpeg.

Install FFmpeg, restart the terminal, then run:

```bash
npm start
```

---

### Highest quality MP4/WebM fails

Highest quality video often requires FFmpeg because video and audio may need to be merged.

Install FFmpeg:

```bash
winget install Gyan.FFmpeg
```

---

### Video requires login or age verification

Use browser cookies:

```bash
YTDLP_COOKIES_FROM_BROWSER=chrome npm start
```

Make sure you are logged in to YouTube in that browser.

---

## API Endpoints

The frontend uses these backend endpoints:

```text
GET     /api/health
POST    /api/resolve
POST    /api/download
GET     /api/jobs
GET     /api/jobs/:id
GET     /api/jobs/:id/events
POST    /api/jobs/:id/cancel
POST    /api/jobs/:id/restart
DELETE  /api/jobs/:id
GET     /api/jobs/:id/file
```

---

## Frontend Files

The UI is inside the `public` folder:

```text
public/index.html
public/styles.css
public/app.js
```

To upgrade only the frontend, replace the existing `public` folder with the new upgraded `public` folder.

---

## Notes

This project is for educational and personal-use purposes. Always follow copyright laws and platform terms of service.

```
```
