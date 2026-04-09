# Anime Downloader

A blazing-fast, interactive CLI downloader for anime episodes, powered by the 9AnimeTV backend and Hakuneko's parallel download architecture.

## Features
- **Interactive Search & Select:** Easily search for anime and select titles via the command line interface.
- **Episode Selection:** Download a single episode (`1`), multiple specific ones (`1,2,5-8`), or all of them at once (`all`).
- **Hakuneko Turbo-Downloads:** 
  - Utilizes extremely fast, asynchronous range requests for MP4 files.
  - Automatically fetches `.ts` fragments of HLS streams (m3u8) in parallel using Node.js, bypassing the slow sequential downloads of ffmpeg (ffmpeg is only used locally for multiplexing).
- **Batch Downloads:** Download multiple episodes concurrently to saturate your network bandwidth.

## Prerequisites
- Node.js
- `ffmpeg` must be installed on your system (added to Path) to multiplex HLS streams into mp4 files. 
  - *Arch/CachyOS:* `sudo pacman -S ffmpeg`
  - *Windows:* via winget `winget install ffmpeg`

## Installation

```bash
npm install
```

## Usage

Start the downloader script via npm:

```bash
npm run download
```

Follow the on-screen instructions in the CLI menu to search and download your anime!

## Disclaimer
This project is for educational and developmental purposes only. Users are expected to respect local laws and content copyrights.
