#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const readline = require("readline/promises");
const { stdin, stdout } = require("process");
const { spawn } = require("child_process");
const axios = require("axios");
const { NineAnimeClient } = require("../index");
const HakunekoDownloader = require("../src/utils/hakuneko-downloader");

function sanitizeName(value) {
  return String(value || "unknown")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEpisodeSelection(input, availableNumbers) {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return [];
  if (text === "all") return [...availableNumbers];

  const selected = new Set();
  const chunks = text.split(",").map((s) => s.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const rangeMatch = chunk.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const [min, max] = start <= end ? [start, end] : [end, start];
      for (let n = min; n <= max; n += 1) {
        if (availableNumbers.has(n)) selected.add(n);
      }
      continue;
    }

    const single = Number(chunk);
    if (Number.isFinite(single) && availableNumbers.has(single)) {
      selected.add(single);
    }
  }

  return [...selected].sort((a, b) => a - b);
}

function pickBestSource(sourcesResult, preferredKind = "sub") {
  const groups = [];
  if (preferredKind === "dub") groups.push(sourcesResult.dub);
  groups.push(sourcesResult.sub, sourcesResult.dub, sourcesResult.unknown, sourcesResult.sources);

  const candidates = groups
    .flatMap((group) => (Array.isArray(group) ? group : []))
    .flatMap((src) => {
      const streams = Array.isArray(src.streams) ? src.streams : [];
      if (streams.length > 0) {
        return streams.map((stream) => ({
          url: stream?.file || null,
          type: String(stream?.type || "").toLowerCase(),
          quality: stream?.quality || "auto",
          headers: src.headers || {},
          server: src.server || "unknown",
        }));
      }

      if (src.streamUrl) {
        const url = String(src.streamUrl);
        return [{
          url,
          type: url.toLowerCase().includes(".m3u8") ? "hls" : "mp4",
          quality: "auto",
          headers: src.headers || {},
          server: src.server || "unknown",
        }];
      }

      return [];
    })
    .filter((item) => item.url);

  if (candidates.length === 0) return null;

  const mp4 = candidates.find((c) => c.type.includes("mp4") || c.type.includes("video/mp4"));
  if (mp4) return mp4;

  const hls = candidates.find((c) => c.type.includes("hls") || String(c.url).toLowerCase().includes(".m3u8"));
  if (hls) return hls;

  return candidates[0];
}

async function downloadDirectFile(url, outputFile, headers = {}, onProgress) {
  const downloader = new HakunekoDownloader({ maxConcurrent: 5 });
  await downloader.downloadMp4(url, outputFile, headers, onProgress);
}

function downloadWithFfmpeg(m3u8Url, outputFile, headers = {}, onProgress) {
  const downloader = new HakunekoDownloader({ maxConcurrent: 5 });
  return downloader.downloadHls(m3u8Url, outputFile, headers, onProgress);
}

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const nine = new NineAnimeClient({
    baseUrl: "https://9animetv.to",
  });

  try {
    const query = await rl.question("Anime search query: ");
    const results = await nine.search(query);
    if (!results.length) {
      console.log("No results found.");
      return;
    }

    console.log("\nResults:");
    results.slice(0, 10).forEach((item, idx) => {
      console.log(`[${idx + 1}] ${item.title} (${item.id})`);
    });

    const pickedRaw = await rl.question("\nSelect a number (1-10): ");
    const picked = Number(pickedRaw);
    if (!Number.isFinite(picked) || picked < 1 || picked > Math.min(results.length, 10)) {
      throw new Error("Invalid selection.");
    }

    const anime = results[picked - 1];
    const info = await nine.getAnimeInfo(anime.id);
    const numberedEpisodes = info.episodes.filter((ep) => Number.isFinite(ep.number));
    const availableNumbers = new Set(numberedEpisodes.map((ep) => ep.number));
    if (!numberedEpisodes.length) {
      console.log("No numbered episodes found.");
      return;
    }

    const min = Math.min(...numberedEpisodes.map((ep) => ep.number));
    const max = Math.max(...numberedEpisodes.map((ep) => ep.number));
    console.log(`\nAvailable episodes: ${min} to ${max} (${numberedEpisodes.length} total)`);
    console.log("Selection format: all or e.g., 1,2,5-8");
    const selectionRaw = await rl.question("Which episodes to download? ");
    const selected = parseEpisodeSelection(selectionRaw, availableNumbers);
    if (!selected.length) {
      throw new Error("No valid episodes selected.");
    }

    const kind = (await rl.question("Preferred language [sub/dub] (default: sub): ")).trim().toLowerCase() === "dub" ? "dub" : "sub";

    const concRaw = await rl.question("Concurrent episode downloads (1-10, default: 1): ");
    let CONCURRENCY_LIMIT = Number(concRaw);
    if (!Number.isFinite(CONCURRENCY_LIMIT) || CONCURRENCY_LIMIT < 1) CONCURRENCY_LIMIT = 1;
    if (CONCURRENCY_LIMIT > 10) CONCURRENCY_LIMIT = 10;

    const baseDirRaw = await rl.question("Target folder (default: ./downloads): ");
    const baseDir = path.resolve(process.cwd(), baseDirRaw.trim() || "downloads");
    const animeDir = path.join(baseDir, sanitizeName(info.title || anime.title || anime.id));
    fs.mkdirSync(animeDir, { recursive: true });

    console.log(`\nStarting downloads to: ${animeDir}`);
    const downloadEpisode = async (number) => {
      const episode = numberedEpisodes.find((ep) => ep.number === number);
      if (!episode) return;

      const fileBase = `${sanitizeName(info.title || anime.title || "Anime")} - E${String(number).padStart(3, "0")}`;
      const tmpFile = path.join(animeDir, `${fileBase}.tmp.mp4`);
      const outFile = path.join(animeDir, `${fileBase}.mp4`);

      try {
        console.log(`\n[E${number}] Loading sources...`);
        const sources = await nine.getEpisodeSources(episode.episodeId);
        const best = pickBestSource(sources, kind);
        if (!best) {
          console.log(`[E${number}] No downloadable source found, skipped.`);
          return;
        }

        console.log(`[E${number}] Server=${best.server} Quality=${best.quality} Type=${best.type || "unknown"}`);
        const onProgress = (percent) => {
          process.stdout.write(`\r[E${number}] Download progress: ${(percent * 100).toFixed(1)}% `);
        };

        if (String(best.url).toLowerCase().includes(".m3u8") || String(best.type).includes("hls")) {
          await downloadWithFfmpeg(best.url, tmpFile, best.headers, onProgress);
        } else {
          await downloadDirectFile(best.url, tmpFile, best.headers, onProgress);
        }
        process.stdout.write("\n");

        fs.renameSync(tmpFile, outFile);
        console.log(`[E${number}] Finished: ${outFile}`);
      } catch (err) {
        if (fs.existsSync(tmpFile)) fs.rmSync(tmpFile, { force: true });
        console.error(`\n[E${number}] Error: ${err.message}`);
      }
    };

    const taskQueue = [...selected];

    const workers = Array(CONCURRENCY_LIMIT).fill(null).map(async () => {
      while (taskQueue.length > 0) {
        const number = taskQueue.shift();
        await downloadEpisode(number);
      }
    });

    await Promise.all(workers);
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
