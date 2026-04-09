const { DEFAULT_BASE_URL, DEFAULT_HEADERS } = require("./constants");
const { NineAnimeError } = require("./errors");
const { NineAnimeHttpClient } = require("./http-client");
const { parseAnimeInfo } = require("./parsers/anime-info");
const { parseEpisodeListFromAjaxHtml } = require("./parsers/episodes");
const { parseSearchResults } = require("./parsers/search");
const { extractEmbedUrlFromSourcesPayload, parseServersFromAjaxHtml } = require("./parsers/sources");
const { requireNonEmptyString } = require("./utils/inputs");
const { normalizeBaseUrl } = require("./utils/url");

class NineAnimeClient {
  constructor(options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL) || DEFAULT_BASE_URL;

    this.baseUrl = baseUrl;
    this.episodeSkipProvider = typeof options.episodeSkipProvider === "function" ? options.episodeSkipProvider : null;
    this.http = new NineAnimeHttpClient({
      baseUrl,
      timeoutMs: options.timeoutMs,
      headers: {
        ...DEFAULT_HEADERS,
        ...(options.headers ?? {}),
      },
      headerProvider: options.headerProvider,
      useEnvProxy: options.useEnvProxy,
    });
  }

  makeUrl(pathname) {
    return this.http.makeUrl(pathname);
  }

  async search(query) {
    const q = requireNonEmptyString(query, "search(query)");
    try {
      const html = await this.http.get(`/search?keyword=${encodeURIComponent(q)}`);
      return parseSearchResults(html, this.baseUrl);
    } catch (cause) {
      if (cause instanceof NineAnimeError) throw cause;
      throw new NineAnimeError(`search() failed for query "${q}"`, { cause });
    }
  }

  async getAnimeInfo(id) {
    const animeId = requireNonEmptyString(id, "getAnimeInfo(id)");
    try {
      const watchPath = `/watch/unknown-${encodeURIComponent(animeId)}`;
      const html = await this.http.get(watchPath);
      const info = parseAnimeInfo(html, this.baseUrl, animeId);

      const episodeListPayload = await this.http.get(`/ajax/episode/list/${encodeURIComponent(animeId)}`, {
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });

      let episodeListHtml = null;
      try {
        const parsed = typeof episodeListPayload === "string" ? JSON.parse(episodeListPayload) : episodeListPayload;
        episodeListHtml = parsed?.html || null;
      } catch {
        episodeListHtml = null;
      }

      const episodes = episodeListHtml ? parseEpisodeListFromAjaxHtml(episodeListHtml, this.baseUrl) : [];

      return {
        ...info,
        episodes,
      };
    } catch (cause) {
      if (cause instanceof NineAnimeError) throw cause;
      throw new NineAnimeError(`getAnimeInfo(${animeId}) failed`, { cause });
    }
  }

  async getEpisodes(animeId) {
    const id = requireNonEmptyString(animeId, "getEpisodes(animeId)");
    try {
      const episodeListPayload = await this.http.get(`/ajax/episode/list/${encodeURIComponent(id)}`, {
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });

      let episodeListHtml = null;
      try {
        const parsed = typeof episodeListPayload === "string" ? JSON.parse(episodeListPayload) : episodeListPayload;
        episodeListHtml = parsed?.html || null;
      } catch {
        episodeListHtml = null;
      }

      return {
        id,
        episodes: episodeListHtml ? parseEpisodeListFromAjaxHtml(episodeListHtml, this.baseUrl) : [],
      };
    } catch (cause) {
      if (cause instanceof NineAnimeError) throw cause;
      throw new NineAnimeError(`getEpisodes(${id}) failed`, { cause });
    }
  }

  async getEpisodeSources(episodeId) {
    const epId = requireNonEmptyString(episodeId, "getEpisodeSources(episodeId)");
    try {
      const skip = await this.getEpisodeSkip(epId).catch(() => ({ intro: null, outro: null }));

      const serversPayload = await this.http.get(`/ajax/episode/servers?episodeId=${encodeURIComponent(epId)}`, {
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });

      let serversHtml = null;
      try {
        const parsed = typeof serversPayload === "string" ? JSON.parse(serversPayload) : serversPayload;
        serversHtml = parsed?.html || null;
      } catch {
        serversHtml = null;
      }

      if (!serversHtml) {
        throw new NineAnimeError(`Could not load servers for episodeId=${epId}`, {
          url: this.makeUrl(`/ajax/episode/servers?episodeId=${encodeURIComponent(epId)}`),
        });
      }

      const servers = parseServersFromAjaxHtml(serversHtml);

      const resolveList = async (entries, kind) => {
        const out = [];
        for (const entry of entries) {
          let payload;
          try {
            payload = await this.http.get(`/ajax/episode/sources?id=${encodeURIComponent(entry.sourceId)}`, {
              headers: { "X-Requested-With": "XMLHttpRequest" },
            });
          } catch (e) {
            out.push({
              kind,
              server: entry.server,
              sourceId: entry.sourceId,
              embedUrl: null,
              error: String(e?.message || e),
            });
            continue;
          }

          const { embedUrl, streamUrl, streams, tracks, headers, raw } = extractEmbedUrlFromSourcesPayload(payload, this.baseUrl);
          let finalStreamUrl = streamUrl;
          let finalStreams = Array.isArray(streams) ? streams : [];
          let finalTracks = Array.isArray(tracks) ? tracks : [];
          let finalHeaders = headers || {};
          let finalRaw = raw;

          if (embedUrl && finalStreams.length === 0 && !finalStreamUrl) {
            const resolved = await this.resolveRapidCloudSources(embedUrl).catch(() => null);
            if (resolved) {
              finalStreams = resolved.streams;
              finalTracks = resolved.tracks;
              finalHeaders = {
                ...finalHeaders,
                ...(resolved.headers || {}),
              };
              finalStreamUrl = resolved.streamUrl || finalStreamUrl;
              finalRaw = {
                primary: raw,
                rapidCloud: resolved.raw,
              };
            }
          }

          out.push({
            kind,
            server: entry.server,
            sourceId: entry.sourceId,
            embedUrl,
            streamUrl: finalStreamUrl,
            streams: finalStreams,
            tracks: finalTracks,
            headers: finalHeaders,
            intro: normalizeSkipMarker(finalRaw?.rapidCloud?.intro ?? finalRaw?.intro ?? null),
            outro: normalizeSkipMarker(finalRaw?.rapidCloud?.outro ?? finalRaw?.outro ?? null),
            raw: finalRaw,
          });
        }
        return out;
      };

      const [sub, dub, unknown] = await Promise.all([
        resolveList(servers.sub, "sub"),
        resolveList(servers.dub, "dub"),
        resolveList(servers.unknown, "unknown"),
      ]);

      const allSources = [...sub, ...dub, ...unknown];
      const extractedIntro = allSources.map((s) => s.intro).find((m) => m) || null;
      const extractedOutro = allSources.map((s) => s.outro).find((m) => m) || null;

      return {
        episodeId: epId,
        intro: skip.intro ?? extractedIntro ?? null,
        outro: skip.outro ?? extractedOutro ?? null,
        sub,
        dub,
        unknown,
        sources: allSources,
      };
    } catch (cause) {
      if (cause instanceof NineAnimeError) throw cause;
      throw new NineAnimeError(`getEpisodeSources(${epId}) failed`, { cause });
    }
  }

  async getEpisodeSkip(episodeId) {
    const epId = requireNonEmptyString(episodeId, "getEpisodeSkip(episodeId)");

    if (!this.episodeSkipProvider) {
      return { intro: null, outro: null };
    }

    try {
      const result = await this.episodeSkipProvider(epId);
      const intro = result?.intro ?? null;
      const outro = result?.outro ?? null;

      return {
        intro: intro && Number.isFinite(intro.start) && Number.isFinite(intro.end) ? intro : null,
        outro: outro && Number.isFinite(outro.start) && Number.isFinite(outro.end) ? outro : null,
      };
    } catch (cause) {
      throw new NineAnimeError(`getEpisodeSkip(${epId}) failed`, { cause });
    }
  }

  async resolveRapidCloudSources(embedUrl) {
    const u = String(embedUrl || "").trim();
    if (!u) return null;

    let parsed;
    try {
      parsed = new URL(u);
    } catch {
      return null;
    }

    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith("rapid-cloud.co") && !host.endsWith("megacloud.tv") && !host.endsWith("megacloud.club") && !host.endsWith("megacloud.co")) {
      return null;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    const id = parts[parts.length - 1] || "";
    if (!id || id === "e-1" || id === "v2") return null;

    const ajaxUrl = `${parsed.origin}/embed-2/v2/e-1/getSources?id=${encodeURIComponent(id)}`;
    const payload = await this.http.get(ajaxUrl, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Referer: u,
      },
    });

    const normalized = typeof payload === "string" ? JSON.parse(payload) : payload;
    if (!normalized || typeof normalized !== "object") return null;

    const list = Array.isArray(normalized.sources) ? normalized.sources : [];
    const streams = list
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const file = entry.file || entry.src || entry.url || null;
        if (!file) return null;
        return {
          file: file,
          type: entry.type || (String(file).toLowerCase().includes(".m3u8") ? "hls" : "unknown"),
          quality: entry.label || entry.quality || "auto",
        };
      })
      .filter(Boolean);

    const tracks = (Array.isArray(normalized.tracks) ? normalized.tracks : [])
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const file = entry.file || entry.src || entry.url || null;
        if (!file) return null;
        return {
          file,
          label: entry.label || entry.kind || "unknown",
        };
      })
      .filter(Boolean);

    return {
      streamUrl: streams[0]?.file || null,
      streams,
      tracks,
      headers: { Referer: parsed.origin + "/" },
      intro: normalizeSkipMarker(normalized.intro ?? null),
      outro: normalizeSkipMarker(normalized.outro ?? null),
      raw: normalized,
    };
  }
}

function normalizeSkipMarker(marker) {
  if (!marker || typeof marker !== "object") return null;
  const start = Number(marker.start);
  const end = Number(marker.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start <= 0 && end <= 0) return null;
  if (!(end > start)) return null;
  return { start, end };
}

function createNineAnimeClient(options) {
  return new NineAnimeClient(options);
}

module.exports = {
  NineAnimeClient,
  createNineAnimeClient,
};

