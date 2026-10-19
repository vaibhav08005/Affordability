function parseLink(link) {
  const url = new URL(link);
  if (url.protocol !== "ofc:" || url.hostname !== "open" || !["", "/"].includes(url.pathname)) {
    throw new Error("Invalid Open Filled Calculator link.");
  }
  const ticket = url.searchParams.get("ticket") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error("Invalid handoff ticket.");
  const server = new URL(url.searchParams.get("server") ?? "");
  const local = server.protocol === "http:" && ["localhost", "127.0.0.1"].includes(server.hostname);
  if ((!local && server.protocol !== "https:") || server.username || server.password || server.pathname !== "/" || server.search || server.hash) {
    throw new Error("The website address in this link is invalid.");
  }
  return { ticket, serverUrl: server.origin };
}

module.exports = { parseLink };
