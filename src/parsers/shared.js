function parseWatchHrefToId(href) {
  const m = String(href || "").match(/\/watch\/[^/?#]+-(\d+)(?:[/?#]|$)/);
  return m ? m[1] : null;
}

function parseEpisodeHrefToEpisodeId(href) {
  const u = String(href || "");
  const m = u.match(/[?&]ep=(\d+)/);
  return m ? m[1] : null;
}

module.exports = {
  parseWatchHrefToId,
  parseEpisodeHrefToEpisodeId,
};

