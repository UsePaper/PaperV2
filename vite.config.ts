import { defineConfig } from "vite";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  // Do not let Vite clear the screen over the Rust errors.
  clearScreen: false,
  build: {
    // Pinned rather than left to the default, which moves between Vite
    // versions and silently decides the oldest macOS the app can run on.
    // Safari 16 is what macOS 13 ships, and that is the floor declared in
    // tauri.conf.json. The two have to agree or the app installs and breaks.
    target: "safari16",
  },
  server: {
    // Tauri expects this exact port and fails rather than moving.
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
