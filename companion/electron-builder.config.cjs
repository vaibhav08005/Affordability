const { build } = require("./package.json");

module.exports = {
  ...build,
  publish: [{
    provider: "generic",
    url: process.env.OFC_UPDATE_FEED_URL || "https://updates.invalid/open-filled-calculator"
  }]
};
