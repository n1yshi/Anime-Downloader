const cheerio = require("cheerio");
const { cleanText } = require("../utils/text");
const { toAbsoluteUrl } = require("../utils/url");
const { parseEpisodeHrefToEpisodeId } = require("./shared");

function parseEpisodeListFromAjaxHtml(episodeListHtml, baseUrl) {
  const $$ = cheerio.load(episodeListHtml);
  const episodes = [];

  $$("a[href*='?ep=']").each((_, a) => {
    const href = $$(a).attr("href");
    const episodeId = parseEpisodeHrefToEpisodeId(href);
    if (!episodeId) return;

    const numText = cleanText($$(a).text());
    const number = numText && /^\d+$/.test(numText) ? Number(numText) : null;
    const url = toAbsoluteUrl(baseUrl, href);
    if (!url) return;

    episodes.push({ number, episodeId: String(episodeId), url });
  });

  const byId = new Map();
  for (const ep of episodes) byId.set(ep.episodeId, ep);

  return [...byId.values()].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}

module.exports = { parseEpisodeListFromAjaxHtml };

