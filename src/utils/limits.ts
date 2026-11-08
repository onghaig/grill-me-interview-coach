/** Input limits. The server enforces the same numbers; these give instant feedback in the browser. */
export const LIMITS = {
  resumeChars: 15_000,
  resumeTextFileBytes: 200 * 1024,
  pdfBytes: 3 * 1024 * 1024,
  principlesChars: 6_000,
  roleChars: 500,
  promptChars: 4_000,
};
