const express = require("express");
const cors = require("cors");
const path = require("path");
const { Readable } = require("stream");
const dns = require("dns").promises;
const net = require("net");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const allowedExtensions = [
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".avi",
  ".ogg",
  ".m4v"
];

const allowedContentTypes = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "video/x-msvideo",
  "video/ogg",
  "application/octet-stream"
];

function isPrivateIp(ip) {
  if (!net.isIP(ip)) return true;

  // IPv4 private/local ranges
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("127.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("169.254.")) return true;

  const parts = ip.split(".").map(Number);
  if (parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }

  // IPv6 localhost/private/link-local ranges
  if (ip === "::1") return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true;

  return false;
}

async function isSafeUrl(inputUrl) {
  let parsed;

  try {
    parsed = new URL(inputUrl);
  } catch {
    return { safe: false, reason: "Invalid URL." };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { safe: false, reason: "Only HTTP and HTTPS links are allowed." };
  }

  const addresses = await dns.lookup(parsed.hostname, { all: true });

  for (const address of addresses) {
    if (isPrivateIp(address.address)) {
      return {
        safe: false,
        reason: "Private/local network URLs are blocked for security."
      };
    }
  }

  return { safe: true, parsed };
}

function getFileNameFromUrl(videoUrl) {
  const parsed = new URL(videoUrl);
  const rawName = path.basename(parsed.pathname);

  if (!rawName || !rawName.includes(".")) {
    return `downloaded-video-${Date.now()}.mp4`;
  }

  return decodeURIComponent(rawName).replace(/[^\w.\-() ]/g, "_");
}

function hasVideoExtension(videoUrl) {
  const parsed = new URL(videoUrl);
  const pathname = parsed.pathname.toLowerCase();
  return allowedExtensions.some(ext => pathname.endsWith(ext));
}

function isYouTubeLink(videoUrl) {
  return /youtube\.com|youtu\.be/i.test(videoUrl);
}

app.post("/api/check", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, message: "URL is required." });
  }

  if (isYouTubeLink(url)) {
    return res.json({
      success: true,
      type: "youtube",
      message: "YouTube links can be previewed, but not downloaded by this tool."
    });
  }

  try {
    const safeCheck = await isSafeUrl(url);

    if (!safeCheck.safe) {
      return res.status(400).json({ success: false, message: safeCheck.reason });
    }

    if (!hasVideoExtension(url)) {
      return res.status(400).json({
        success: false,
        message: "Only direct video file URLs are supported, such as .mp4, .webm, .mov, .mkv."
      });
    }

    try {
      const response = await fetch(url, {
        method: "HEAD",
        headers: {
          "User-Agent": "Mozilla/5.0 DirectVideoDownloader/1.0"
        }
      });

      const contentType = response.headers.get("content-type") || "unknown";
      const contentLength = response.headers.get("content-length");

      return res.json({
        success: true,
        type: "direct",
        fileName: getFileNameFromUrl(url),
        contentType,
        size: contentLength ? Number(contentLength) : null,
        downloadable: response.ok
      });
    } catch {
      return res.json({
        success: true,
        type: "direct",
        fileName: getFileNameFromUrl(url),
        contentType: "unknown",
        size: null,
        downloadable: true,
        message: "Could not verify file with HEAD request, but download may still work."
      });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server failed to check the URL."
    });
  }
});

app.get("/api/download", async (req, res) => {
  const videoUrl = req.query.url;

  if (!videoUrl) {
    return res.status(400).send("Missing video URL.");
  }

  if (isYouTubeLink(videoUrl)) {
    return res.status(400).send("YouTube downloading is not supported.");
  }

  try {
    const safeCheck = await isSafeUrl(videoUrl);

    if (!safeCheck.safe) {
      return res.status(400).send(safeCheck.reason);
    }

    if (!hasVideoExtension(videoUrl)) {
      return res.status(400).send("Only direct video file URLs are supported.");
    }

    const upstream = await fetch(videoUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 DirectVideoDownloader/1.0"
      }
    });

    if (!upstream.ok) {
      return res.status(400).send("Could not fetch the video file.");
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";

    const isAllowedType =
      allowedContentTypes.some(type => contentType.includes(type)) ||
      contentType.includes("video/") ||
      contentType === "application/octet-stream";

    if (!isAllowedType) {
      return res.status(400).send("The URL does not appear to be a video file.");
    }

    const fileName = getFileNameFromUrl(videoUrl);
    const contentLength = upstream.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.pipe(res);

    nodeStream.on("error", () => {
      if (!res.headersSent) {
        res.status(500).send("Download stream failed.");
      } else {
        res.destroy();
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server failed to download the video.");
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
