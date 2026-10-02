declare const APP_URL: string;

/** The app whose words the extension adds to, set at build time (see build.mjs). */
export const appUrl = APP_URL;
export const appMatch = `${new URL(APP_URL).origin}${new URL(APP_URL).pathname}*`;
export const lexiconUrl = new URL("lexicon/", APP_URL).href;
/** A small static page on the app's site, opened in the background to save words when no Italian tab is open. */
export const quietPageUrl = new URL("lexicon/ATTRIBUTION.txt", APP_URL).href;
