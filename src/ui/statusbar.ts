import { onFileStateChange } from "../file/state";

export interface StatusbarHandle {
  /** Call after the document changed. */
  update(words: number): void;
}

export function mountStatusbar(root: HTMLElement): StatusbarHandle {
  root.innerHTML = "";

  const fileInfo = document.createElement("span");
  fileInfo.className = "statusbar-file";

  const wordInfo = document.createElement("span");
  wordInfo.className = "statusbar-words";

  root.append(fileInfo, wordInfo);

  onFileStateChange((state) => {
    const parts = [state.path ?? "Not saved"];
    if (state.dirty) parts.push("unsaved changes");
    if (state.lineEnding === "crlf") parts.push("CRLF");
    fileInfo.textContent = parts.join(" · ");
  });

  return {
    update(words: number): void {
      wordInfo.textContent = words === 1 ? "1 word" : `${words} words`;
    },
  };
}
