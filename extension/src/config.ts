declare const APP_URL: string;

/** The app the extension saves words to, set at build time (see build.mjs). */
export const appUrl = APP_URL;
export const appMatch = `${new URL(APP_URL).origin}${new URL(APP_URL).pathname}*`;
export const lexiconUrl = new URL("lexicon/", APP_URL).href;
