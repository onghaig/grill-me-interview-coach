/** Plain-English explanation of why the interview connection closed, for the on-screen notice. */
export function describeClose(code: number, reason?: string): { text: string; detail: string } {
  const detail = `WebSocket closed with code ${code}${reason ? `: ${reason}` : ''}`;
  switch (code) {
    case 1001:
      return { text: 'The server is restarting. Your progress is saved, rejoin in a few seconds.', detail };
    case 1006:
      return { text: 'The connection to the server was lost (network drop or the server stopped). Your progress is saved.', detail };
    case 1008:
    case 4401:
      return { text: 'You were signed out. Sign in again to continue.', detail };
    case 1009:
      return { text: 'A message was too large for the server (probably a very large whiteboard or code snapshot), so the connection was closed.', detail };
    case 1011:
      return { text: 'The server hit an error and closed the connection.', detail };
    default:
      return { text: 'The interview connection closed unexpectedly.', detail };
  }
}
