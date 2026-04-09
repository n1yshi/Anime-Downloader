const cheerio = require("cheerio");
const { cleanText } = require("../utils/text");
const { toAbsoluteUrl } = require("../utils/url");

function parseAnimeInfo(html, baseUrl, animeId) {
  const $ = cheerio.load(html);

  const title = cleanText($("h2, h1").first().text()) || null;

  const altTitlesLine = cleanText($("h2, h1").first().nextAll("div, p").first().text());
  const altTitles = altTitlesLine
    ? altTitlesLine
        .split(",")
        .map((s) => cleanText(s))
        .filter(Boolean)
    : [];

  const description =
    cleanText(
      $("h2, h1")
        .first()
        .parent()
        .find("div, p")
        .not(":has(a)")
        .filter((_, el) => cleanText($(el).text()).length > 80)
        .first()
        .text()
    ) || null;

  const genres = [];
  $("a[href*='/genre/']").each((_, el) => {
    const g = cleanText($(el).text());
    if (g && !genres.includes(g)) genres.push(g);
  });

  const infoPairs = {};
  $("*").each((_, el) => {
    const t = cleanText($(el).text());
    if (!t || t.length > 40) return;
    if (!/^(status|type|country|released)$/i.test(t.replace(/:$/, ""))) return;
    const key = t.replace(/:$/, "").toLowerCase();
    const val =
      cleanText($(el).next().text()) || cleanText($(el).parent().find("a, span").last().text());
    if (val) infoPairs[key] = val;
  });

  const canonical =
    $("link[rel='canonical']").attr("href") ||
    $("meta[property='og:url']").attr("content") ||
    null;
  const coverRaw =
    $("meta[property='og:image']").attr("content") ||
    $("meta[name='twitter:image']").attr("content") ||
    $("img").first().attr("src") ||
    null;

  const url =
    toAbsoluteUrl(baseUrl, canonical) || toAbsoluteUrl(baseUrl, `/watch/unknown-${encodeURIComponent(animeId)}`);
  const cover = toAbsoluteUrl(baseUrl, coverRaw) || null;

  return {
    id: String(animeId),
    title,
    altTitles,
    description,
    genres,
    status: infoPairs.status || null,
    type: infoPairs.type || null,
    country: infoPairs.country || null,
    released: infoPairs.released || null,
    cover,
    url,
  };
}

module.exports = { parseAnimeInfo };

