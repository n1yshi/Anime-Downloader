const cheerio = require("cheerio");
const { cleanText } = require("../utils/text");
const { toAbsoluteUrl } = require("../utils/url");
const { parseWatchHrefToId } = require("./shared");

function parseSearchResults(html, baseUrl) {
  const $ = cheerio.load(html);
  const results = new Map();

  $("a[href*='/watch/']").each((_, el) => {
    const href = $(el).attr("href");
    const id = parseWatchHrefToId(href);
    if (!id) return;

    const title =
      cleanText($(el).attr("title")) ||
      cleanText($(el).find("h3, h2, .name, .title").first().text()) ||
      cleanText($(el).text());

    const url = toAbsoluteUrl(baseUrl, href);
    const imgSrc =
      $(el).find("img").first().attr("src") ||
      $(el).find("img").first().attr("data-src") ||
      $(el).find("img").first().attr("data-original") ||
      $(el).closest(".film-poster, .poster, .item, li, .film-detail").find("img").first().attr("src") ||
      $(el).closest(".film-poster, .poster, .item, li, .film-detail").find("img").first().attr("data-src") ||
      null;
    const cover = imgSrc ? toAbsoluteUrl(baseUrl, imgSrc) : null;
    if (!url || !title) return;

    results.set(id, { id, title, url, cover });
  });

  return [...results.values()];
}

module.exports = { parseSearchResults };

