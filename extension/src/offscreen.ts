// A hidden page that loads a small page of the app's site in a frame, where writer.js saves the
// queued words into the site's storage (see writeThroughHiddenPage in background.ts).
import { quietPageUrl } from "./config";

const frame = document.createElement("iframe");
frame.src = `${quietPageUrl}#italian-writer`;
document.documentElement.append(frame);
