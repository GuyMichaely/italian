// Where the app is: signing in only returns there, and only its pages may call the server.

/** The app address to send the browser back to after signing in, if it's one of the app's. */
export function returnUrl(requested: string, appUrls: string) {
  const url = new URL(requested);
  url.hash = "";
  return appUrls.split(/\s+/).some((app) => app && url.href.startsWith(app)) ? url.href : null;
}

/** Origins the app is served from, for CORS and for checking where a live connection comes from. */
export function appOrigins(appUrls: string) {
  return appUrls.split(/\s+/).filter(Boolean).map((url) => new URL(url).origin);
}
