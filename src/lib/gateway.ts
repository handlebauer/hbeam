/**
 * Shared gateway helpers for host parsing and status-page rendering.
 *
 * @module
 */
const EXPECTED_LOCALHOST_PARTS = 2
const LAST_INDEX = -1
const FIRST_INDEX = 0
const LOCALHOST = 'localhost'

/**
 * Local loopback host used by the gateway command.
 */
export const LOOPBACK_HOST = '127.0.0.1'

/**
 * Extract `{peer}` from `http://{peer}.localhost:<port>`.
 *
 * @param hostHeader - Raw Host header value.
 * @returns Subdomain peer target when present.
 */
export function parsePeerTarget(hostHeader: string | undefined): string | undefined {
	if (!hostHeader) {
		return undefined
	}

	const hostWithoutPort = hostHeader.split(':')[FIRST_INDEX]
	if (!hostWithoutPort) {
		return undefined
	}
	const parts = hostWithoutPort.split('.')
	if (parts.length < EXPECTED_LOCALHOST_PARTS || parts.at(LAST_INDEX) !== LOCALHOST) {
		return undefined
	}

	const [subdomain] = parts
	if (!subdomain || subdomain === LOCALHOST) {
		return undefined
	}

	return subdomain
}

/**
 * Escape HTML-special characters in untrusted text content.
 *
 * @param value - Raw text.
 * @returns HTML-safe string.
 */
function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;')
}

/**
 * Render the gateway info page for bare localhost requests.
 *
 * @param port - Active gateway listen port.
 * @returns HTML document string.
 */
export function renderGatewayStatusHtml(port: number): string {
	const exampleName = `workserver.${LOCALHOST}:${port}`
	const exampleKey = `a1b2c3d4e5f6...${LOCALHOST}:${port}`

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>hbeam gateway</title>
  <style>
    :root { color-scheme: light dark; }
    body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 2rem; }
    h1 { font-size: 1rem; margin: 0 0 1rem; }
    p { margin: 0 0 1rem; }
    code { background: rgba(127,127,127,0.16); padding: 0.12rem 0.35rem; border-radius: 0.25rem; }
  </style>
</head>
<body>
  <h1>HBEAM GATEWAY ONLINE</h1>
  <p>Route traffic by subdomain:</p>
  <p><code>http://${escapeHtml(exampleName)}/</code></p>
  <p><code>http://${escapeHtml(exampleKey)}/</code></p>
</body>
</html>`
}
