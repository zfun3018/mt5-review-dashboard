import { readQuery, replaceQuery } from "../shared/js/url-state.mjs";

// URL-backed state for the review album. `tags` is stored as a repeated query
// parameter (`tags=a&tags=b`) so selection round-trips exactly; buildAlbumQuery
// folds it into the server's comma-joined `tag` contract.
const SCHEMA = {
  symbol: { type: "string", default: "" },
  start: { type: "string", default: "" },
  end: { type: "string", default: "" },
  sort: { type: "string", default: "desc", values: ["asc", "desc"] },
  tags: { type: "array", default: [] },
};

export function readAlbumState(search) {
  return readQuery(SCHEMA, search);
}

export function writeAlbumState(state, environment) {
  return replaceQuery(state, environment, SCHEMA);
}

export function buildAlbumQuery(state) {
  const params = new URLSearchParams();
  if (state.symbol) params.set("symbol", state.symbol);
  if (state.start) params.set("start", state.start);
  if (state.end) params.set("end", state.end);
  if (state.tags && state.tags.length) params.set("tag", state.tags.join(","));
  if (state.sort && state.sort !== "desc") params.set("sort", state.sort);
  params.set("page", "1");
  params.set("page_size", "100");
  return params.toString();
}
