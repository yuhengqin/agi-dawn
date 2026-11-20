/**
 * Copies text; in-app browsers without the async clipboard (WeChat and the like) fall back to a selection
 * copy. Rejects when neither copies.
 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    const opener=document.activeElement;
    const container=opener?.closest('dialog[open]')??document.body;
    ta.style.cssText="position:fixed;inset:0 auto auto 0;opacity:0";
    container.appendChild(ta);
    try {
      ta.select();
      if (!document.execCommand("copy")) throw new Error("copy failed");
    } finally {
      ta.remove();
      if(opener instanceof HTMLElement)opener.focus({preventScroll:true});
    }
  }
}
