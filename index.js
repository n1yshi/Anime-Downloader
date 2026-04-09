const { NineAnimeClient, createNineAnimeClient } = require("./src/client");
const { NineAnimeError } = require("./src/errors");

class NineAnime extends NineAnimeClient {}

module.exports = {
  NineAnimeClient,
  createNineAnimeClient,
  NineAnime,
  NineAnimeError,
};

