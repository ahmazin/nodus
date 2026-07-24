/**
 * Sanitize untrusted diagram strings before they are interpolated into human-readable console
 * output. Fields such as a record `label`, `id`, `props.key`, and even a props KEY NAME (which
 * surfaces as a `props.<name>` entry in a drift field list) come verbatim from an attacker-supplied
 * `.nodus.json`; interpolated raw into the `diff`/`drift` report they let embedded CR/LF/ESC/ANSI
 * sequences overwrite or recolor the terminal a reviewer trusts (terminal/log injection, CWE-117),
 * forging the very diff this tool exists to make trustworthy.
 *
 * The fix drops the C0 control range (0x00-0x1F, includes TAB/CR/LF/ESC), DEL (0x7F), and the C1
 * control range (0x80-0x9F). Ordinary printable text -- spaces and non-control Unicode such as
 * accented letters or CJK -- is left byte-for-byte unchanged, so legitimate labels render exactly as
 * before. The check is done on code points (not literal control bytes) so this source file itself
 * carries no control characters.
 */
function isControlCodePoint(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
}

/** Remove C0/C1 control characters (CR, LF, ESC, DEL, ...) from a string bound for console output. */
export function sanitizeText(value: string): string {
  let out = '';
  for (const ch of value) {
    if (!isControlCodePoint(ch.codePointAt(0) ?? 0)) out += ch;
  }
  return out;
}
