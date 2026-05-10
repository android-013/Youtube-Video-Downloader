const videoUrlInput = document.getElementById("videoUrl");
const checkBtn = document.getElementById("checkBtn");
const message = document.getElementById("message");

const resultBox = document.getElementById("resultBox");
const youtubePreview = document.getElementById("youtubePreview");
const videoPreview = document.getElementById("videoPreview");

const fileName = document.getElementById("fileName");
const fileInfo = document.getElementById("fileInfo");

const downloadBtn = document.getElementById("downloadBtn");
const openBtn = document.getElementById("openBtn");

let currentUrl = "";

checkBtn.addEventListener("click", checkVideo);
downloadBtn.addEventListener("click", downloadVideo);
openBtn.addEventListener("click", openVideo);

videoUrlInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    checkVideo();
  }
});

function showMessage(text, type = "success") {
  message.textContent = text;
  message.className = `message ${type}`;
}

function hideMessage() {
  message.className = "message hidden";
  message.textContent = "";
}

function resetResult() {
  resultBox.classList.add("hidden");

  youtubePreview.classList.add("hidden");
  youtubePreview.src = "";

  videoPreview.classList.add("hidden");
  videoPreview.src = "";

  downloadBtn.classList.remove("hidden");

  fileName.textContent = "Video File";
  fileInfo.textContent = "";
}

function getYouTubeId(url) {
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtu\.be\/([^?&]+)/,
    /youtube\.com\/shorts\/([^?&]+)/,
    /youtube\.com\/embed\/([^?&]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }

  return null;
}

function formatBytes(bytes) {
  if (!bytes) return "Unknown size";

  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  const safeIndex = Math.min(index, sizes.length - 1);

  return `${(bytes / Math.pow(1024, safeIndex)).toFixed(2)} ${sizes[safeIndex]}`;
}

async function checkVideo() {
  hideMessage();
  resetResult();

  const url = videoUrlInput.value.trim();

  if (!url) {
    showMessage("Please paste a video URL first.", "error");
    return;
  }

  currentUrl = url;
  checkBtn.textContent = "Checking...";
  checkBtn.disabled = true;

  try {
    const response = await fetch("/api/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      showMessage(data.message || "Could not check this URL.", "error");
      return;
    }

    resultBox.classList.remove("hidden");

    if (data.type === "youtube") {
      const youtubeId = getYouTubeId(url);

      if (youtubeId) {
        youtubePreview.src = `https://www.youtube.com/embed/${youtubeId}`;
        youtubePreview.classList.remove("hidden");
      }

      fileName.textContent = "YouTube Video";
      fileInfo.textContent =
        "This tool can preview YouTube links, but it does not download YouTube videos.";

      downloadBtn.classList.add("hidden");

      showMessage(
        "YouTube preview loaded. Direct downloading from YouTube is not supported.",
        "warning"
      );

      return;
    }

    videoPreview.src = url;
    videoPreview.classList.remove("hidden");

    fileName.textContent = data.fileName || "Direct video file";

    fileInfo.innerHTML = `
      <strong>Type:</strong> ${data.contentType || "Unknown"}<br>
      <strong>Size:</strong> ${formatBytes(data.size)}<br>
      <strong>Status:</strong> Ready to download through backend
    `;

    showMessage("Direct video file detected. Ready to download.", "success");
  } catch (error) {
    console.error(error);
    showMessage("Something went wrong while checking the link.", "error");
  } finally {
    checkBtn.textContent = "Check";
    checkBtn.disabled = false;
  }
}

function downloadVideo() {
  if (!currentUrl) {
    showMessage("No video URL selected.", "error");
    return;
  }

  const downloadUrl = `/api/download?url=${encodeURIComponent(currentUrl)}`;
  window.location.href = downloadUrl;
}

function openVideo() {
  if (!currentUrl) {
    showMessage("No video URL selected.", "error");
    return;
  }

  window.open(currentUrl, "_blank");
}
