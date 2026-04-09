const cheerio = require("cheerio");
const { cleanText } = require("../utils/text");
const { toAbsoluteUrl } = require("../utils/url");

function parseServersFromAjaxHtml(serversHtml) {
  const $ = cheerio.load(serversHtml);

  const result = {
    sub: [],
    dub: [],
    unknown: [],
  };

  const pickSourceId = (el) =>
    $(el).attr("data-id") ||
    $(el).attr("data-link-id") ||
    $(el).attr("data-server-id") ||
    $(el).attr("data-episode-id") ||
    null;

  $("[data-id]").each((_, el) => {
    const sourceId = pickSourceId(el);
    if (!sourceId) return;

    const server = cleanText($(el).text());
    if (!server) return;

    const inSubBlock = $(el).closest(".servers-sub, .ps_-block-sub").length > 0;
    const inDubBlock = $(el).closest(".servers-dub, .ps_-block-dub").length > 0;
    const kind = inDubBlock ? "dub" : inSubBlock ? "sub" : "unknown";

    result[kind].push({ server, sourceId: String(sourceId) });
  });

  if (result.sub.length === 0 && result.dub.length === 0) {
    const known = ["rapid", "cloud", "mega", "wish", "stream", "vid"];
    $("a, button, div, li").each((_, el) => {
      const txt = cleanText($(el).text());
      const low = txt.toLowerCase();
      if (!known.some((k) => low.includes(k))) return;
      const sourceId = pickSourceId(el);
      if (!sourceId) return;

      const blockText = cleanText($(el).closest("div").text()).toLowerCase();
      const kind = blockText.includes("dub") ? "dub" : blockText.includes("sub") ? "sub" : "unknown";
      result[kind].push({ server: txt, sourceId: String(sourceId) });
    });
  }

  for (const kind of ["sub", "dub", "unknown"]) {
    const m = new Map();
    for (const s of result[kind]) m.set(`${s.server}:${s.sourceId}`, s);
    result[kind] = [...m.values()];
  }

  return result;
}

function extractEmbedUrlFromSourcesPayload(payload, baseUrl) {
  let parsed = payload;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
    }
  }

  let embedUrl = null;
  let streamUrl = null;
  let streams = [];
  let tracks = [];
  let headers = {};
  if (parsed && typeof parsed === "object") {
    embedUrl = parsed.link || parsed.url || parsed.embed || null;
    streamUrl = pickStreamUrl(parsed);
    streams = pickStreams(parsed, baseUrl);
    tracks = pickTracks(parsed, baseUrl);
    headers = pickHeaders(parsed);
    if (!embedUrl && typeof parsed.html === "string") {
      const $$ = cheerio.load(parsed.html);
      embedUrl = $$("iframe").attr("src") || $$("a[href]").attr("href") || null;
    }
  } else if (typeof parsed === "string") {
    const $$ = cheerio.load(parsed);
    embedUrl = $$("iframe").attr("src") || $$("a[href]").attr("href") || null;
  }

  return {
    embedUrl: embedUrl ? toAbsoluteUrl(baseUrl, embedUrl) || embedUrl : null,
    streamUrl: streamUrl ? toAbsoluteUrl(baseUrl, streamUrl) || streamUrl : null,
    streams,
    tracks,
    headers,
    raw: parsed,
  };
}

function pickStreamUrl(parsed) {
  if (!parsed || typeof parsed !== "object") return null;

  const fromList = Array.isArray(parsed.sources)
    ? parsed.sources.find((entry) => entry && typeof entry === "object" && (entry.file || entry.src || entry.url))
    : null;
  if (fromList) return fromList.file || fromList.src || fromList.url || null;

  if (parsed.source && typeof parsed.source === "object") {
    return parsed.source.file || parsed.source.src || parsed.source.url || null;
  }

  return parsed.file || parsed.src || null;
}

function pickStreams(parsed, baseUrl) {
  if (!parsed || typeof parsed !== "object") return [];
  if (!Array.isArray(parsed.sources)) return [];

  return parsed.sources
    .map((entry) => {
      if (typeof entry === "string") {
        const file = toAbsoluteUrl(baseUrl, entry) || entry;
        return { file, type: guessStreamType(file), quality: "auto" };
      }
      if (!entry || typeof entry !== "object") return null;
      const file = entry.file || entry.src || entry.url || null;
      if (!file) return null;
      const abs = toAbsoluteUrl(baseUrl, file) || file;
      return {
        file: abs,
        type: entry.type || guessStreamType(abs),
        quality: entry.label || entry.quality || "auto",
      };
    })
    .filter(Boolean);
}

function pickTracks(parsed, baseUrl) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tracks)) return [];
  return parsed.tracks
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const file = entry.file || entry.src || entry.url || null;
      if (!file) return null;
      return {
        file: toAbsoluteUrl(baseUrl, file) || file,
        label: entry.label || entry.kind || "unknown",
      };
    })
    .filter(Boolean);
}

function pickHeaders(parsed) {
  if (!parsed || typeof parsed !== "object") return {};
  const out = {};
  if (parsed.headers && typeof parsed.headers === "object") {
    for (const [k, v] of Object.entries(parsed.headers)) {
      if (typeof v === "string" && v.trim()) out[k] = v;
    }
  }
  if (!out.Referer && typeof parsed.referer === "string" && parsed.referer.trim()) {
    out.Referer = parsed.referer.trim();
  }
  return out;
}

function guessStreamType(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes(".m3u8")) return "hls";
  if (u.includes(".mp4")) return "mp4";
  return "unknown";
}

module.exports = {
  parseServersFromAjaxHtml,
  extractEmbedUrlFromSourcesPayload,
};

