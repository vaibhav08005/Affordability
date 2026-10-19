const required = process.platform === "win32"
  ? ["CSC_LINK", "CSC_KEY_PASSWORD"]
  : process.platform === "darwin"
    ? ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]
    : [];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(`Missing OFC release signing configuration: ${missing.join(", ")}`);
}
