// Browser shims for Node globals used by the near-api-js bundle.
// Injected by esbuild (--inject) so they run before any bundle code.
import { Buffer } from "buffer";

if (typeof window !== "undefined") {
  window.Buffer = Buffer;
  window.global = window;
  window.process = window.process || { env: {} };
}

export { Buffer };
