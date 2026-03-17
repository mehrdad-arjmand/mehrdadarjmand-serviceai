export function ensureTextareaCaretVisible(textarea: HTMLTextAreaElement, caretIndex: number) {
  const document = textarea.ownerDocument;
  const win = document.defaultView;

  if (!win) return;

  const computed = win.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");

  const mirroredProperties = [
    "box-sizing",
    "width",
    "height",
    "overflow-x",
    "overflow-y",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "font-style",
    "font-variant",
    "font-weight",
    "font-stretch",
    "font-size",
    "font-family",
    "line-height",
    "letter-spacing",
    "text-transform",
    "text-indent",
    "text-decoration",
    "text-align",
    "tab-size",
    "white-space",
    "word-break",
    "overflow-wrap",
  ];

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordBreak = "break-word";
  mirror.style.overflowWrap = "break-word";

  mirroredProperties.forEach((property) => {
    mirror.style.setProperty(property, computed.getPropertyValue(property));
  });

  const beforeCaret = textarea.value.slice(0, caretIndex);
  mirror.textContent = beforeCaret;
  marker.textContent = textarea.value.slice(caretIndex, caretIndex + 1) || "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
  const caretTop = Math.max(0, marker.offsetTop - paddingTop);
  const caretHeight = marker.offsetHeight || Number.parseFloat(computed.lineHeight) || 20;
  const caretBottom = caretTop + caretHeight;

  document.body.removeChild(mirror);

  const viewportTop = textarea.scrollTop;
  const viewportBottom = viewportTop + textarea.clientHeight - paddingBottom;
  const viewportPadding = caretHeight * 1.5;

  if (caretTop < viewportTop + paddingTop) {
    textarea.scrollTop = Math.max(0, caretTop - viewportPadding);
    return;
  }

  if (caretBottom > viewportBottom) {
    textarea.scrollTop = Math.max(0, caretBottom - textarea.clientHeight + paddingBottom + viewportPadding);
  }
}
