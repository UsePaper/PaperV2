import type { ViewMode } from "../editor/editor";
import { setWindowTitle, titlebarMetrics } from "../file/bridge";
import { displayName, getFileState, onFileStateChange } from "../file/state";

/** The gap left between the last traffic light and the file name. */
const BUTTON_GAP = 12;

export interface TitlebarHandle {
  /** Reflects the mode the document is being shown in. */
  setMode(mode: ViewMode): void;
}

export interface TitlebarOptions {
  /** Asked for when the mode button is pressed. */
  onCycleMode: () => void;
}

/** What each mode is called, and what pressing the button moves on to. */
export const MODE_LABEL: Readonly<Record<ViewMode, string>> = {
  editing: "Editing",
  presentation: "Presentation",
  reading: "Reading",
};

export const MODE_ORDER: readonly ViewMode[] = ["editing", "presentation", "reading"];

export function nextMode(mode: ViewMode): ViewMode {
  return MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length];
}

/**
 * The document name drawn into the transparent title bar area, and the one
 * control the chrome carries. The buttons, corners and shadow are the
 * system's. On macOS the traffic lights overlay the content, so the bar
 * reserves room for them.
 */
export function mountTitlebar(
  root: HTMLElement,
  options: TitlebarOptions,
): TitlebarHandle {
  root.innerHTML = "";
  // Dragging the bar moves the window, the same as a native title bar.
  root.setAttribute("data-tauri-drag-region", "");

  const title = document.createElement("div");
  title.className = "titlebar-title";
  title.setAttribute("data-tauri-drag-region", "");

  const mode = document.createElement("button");
  mode.type = "button";
  mode.className = "titlebar-mode";
  mode.addEventListener("click", options.onCycleMode);

  root.append(title, mode);

  onFileStateChange(() => {
    const { dirty } = getFileState();
    const name = displayName() + (dirty ? " •" : "");

    title.textContent = name;
    // The same name goes to the window itself. Nothing on screen shows it, but
    // everything outside the window does. Losing it costs nothing here and
    // loses the document everywhere else.
    void setWindowTitle(name).catch(() => {
      // A window that will not be renamed is still perfectly usable.
    });
  });

  void trackNativeChrome(root);

  return {
    setMode(current: ViewMode): void {
      // The shape says which mode it is; the colour stays quiet either way.
      mode.replaceChildren(modeIcon(current));
      mode.dataset.mode = current;

      const label = `${MODE_LABEL[current]}, press for ${MODE_LABEL[nextMode(current)]}`;
      mode.title = label;
      mode.setAttribute("aria-label", label);
    },
  };
}

/** Drawn rather than typed, so it sits on the same line at any text size. */
function modeIcon(mode: ViewMode): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.3");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  for (const d of ICON_PATHS[mode]) {
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }

  // The eye needs a solid pupil, which is the one part that is not a stroke.
  if (mode === "presentation") {
    const pupil = document.createElementNS(namespace, "circle");
    pupil.setAttribute("cx", "8");
    pupil.setAttribute("cy", "8");
    pupil.setAttribute("r", "1.7");
    pupil.setAttribute("fill", "currentColor");
    pupil.setAttribute("stroke", "none");
    svg.append(pupil);
  }

  return svg;
}

/** A pencil for writing, an eye for showing, an open book for reading. */
const ICON_PATHS: Readonly<Record<ViewMode, readonly string[]>> = {
  editing: ["M2.8 13.2l.5-2.3 7.2-7.2 1.8 1.8-7.2 7.2-2.3.5z", "M9.6 4.4l1.8 1.8"],
  presentation: ["M1.6 8S4 4.3 8 4.3 14.4 8 14.4 8 12 11.7 8 11.7 1.6 8 1.6 8Z"],
  reading: [
    "M8 4.6v8.2",
    "M8 4.6C6.9 3.8 5.6 3.4 4 3.4H1.9v8.2H4c1.6 0 2.9.4 4 1.2",
    "M8 4.6c1.1-.8 2.4-1.2 4-1.2h2.1v8.2H12c-1.6 0-2.9.4-4 1.2",
  ],
};

/**
 * Matches the bar to the system chrome by measuring it rather than assuming its
 * geometry. Both numbers have already proved to differ from the published ones,
 * and the band height is what puts the file name on the traffic lights' centre
 * line. Full screen hides the buttons and reports zero, so the indent collapses
 * on its own.
 */
async function trackNativeChrome(root: HTMLElement): Promise<void> {
  async function apply(): Promise<void> {
    const metrics = await titlebarMetrics();
    if (!metrics) return;

    // Full screen takes the system title bar away, so AppKit reports a band of
    // nothing. Ours is still there, still holding the file name and the mode
    // button, and still needs the height to stand them in: fall back to the
    // stylesheet rather than collapsing the bar onto its own contents.
    if (metrics.height > 0) {
      document.documentElement.style.setProperty(
        "--titlebar-height",
        `${metrics.height}px`,
      );
    } else {
      document.documentElement.style.removeProperty("--titlebar-height");
    }
    root.style.paddingLeft =
      metrics.trafficLightsRight === 0
        ? ""
        : `${metrics.trafficLightsRight + BUTTON_GAP}px`;
  }

  await apply();
  // Entering or leaving full screen changes both, and resize is the one event
  // the webview sees for it.
  window.addEventListener("resize", () => void apply());
}
