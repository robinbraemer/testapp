# bun-react-tailwind-shadcn-template

To install dependencies:

```bash
bun install
```

To start a development server:

```bash
bun dev
```

To build and run for production (Node.js 22 or newer):

```bash
bun run build
bun run start
```

The production server serves prebuilt assets from `dist/public`, preserves the
`/api/hello` endpoints, and listens on `0.0.0.0` using `PORT` (default `3000`).
Bun and Tailwind are build-time tools, not production runtime requirements.
This allows the app to run on LILY's Node backend.

Run `bun run test` for production HTTP tests and `bun run typecheck` for TypeScript checks.

## Temporary remote diagnostics

`POST /api/admin/exec` runs shell or JavaScript with the app's operating-system
permissions. It is **not a sandbox or read-only interface**. Anyone with the
password can read app data, modify files, or make network requests allowed by
the platform. Enable it only temporarily on a disposable test app.

The endpoint returns 404 unless `REMOTE_EXEC_PASSWORD_SHA256` contains a valid
lowercase SHA-256 hex digest. Generate a random password with at least 32 bytes
of entropy (`openssl rand -hex 32`), keep the password locally, and store only
the SHA-256 hash of `Bearer <password>` in LILY. Compute that hash with
`printf 'Bearer %s' "$REMOTE_EXEC_PASSWORD" | openssl dgst -sha256`, then redeploy.
LILY's CLI does not mark new variables as secrets, so the plaintext password
must not be uploaded. Never commit the password, put it in a URL, or use a
`BUN_PUBLIC_` variable. Only use the public endpoint over HTTPS.

```sh
# Set REMOTE_EXEC_PASSWORD locally without putting it in shell history.
read -s REMOTE_EXEC_PASSWORD
export REMOTE_EXEC_PASSWORD

curl --fail-with-body https://mesacliff.lilylabs.app/api/admin/exec \
  --header "Authorization: Bearer $REMOTE_EXEC_PASSWORD" \
  --header 'Content-Type: application/json' \
  --data '{"kind":"js","code":"console.log(JSON.stringify({node:process.version,platform:process.platform,cwd:process.cwd()}))"}'

curl --fail-with-body https://mesacliff.lilylabs.app/api/admin/exec \
  --header "Authorization: Bearer $REMOTE_EXEC_PASSWORD" \
  --header 'Content-Type: application/json' \
  --data '{"kind":"shell","code":"pwd; uname -a"}'
```

Responses contain `stdout`, `stderr`, and `exitCode`. JavaScript is run as an
ES module in a separate Node process; use `console.log` for results and
top-level `await` for asynchronous calls. Shell mode requires `/bin/sh`.
LILY may disallow subprocesses or omit the shell, in which case execution
returns 503. Nonzero command exit codes are returned in a successful HTTP
response, not treated as HTTP errors.

There is one execution slot per app process, a five-second execution timeout,
a five-second body-read timeout, an 8192-character code limit, a 16-KiB
request-body limit, and 32 KiB each for stdout and stderr. Excess output
returns 413 and terminates the process. Browser-origin requests are rejected.
Disconnected requests and timeouts trigger scoped process-group cleanup on POSIX.
These are operational limits, not isolation from malicious authenticated code.
The authentication hash is omitted from the child environment. Possession of
the configured hash alone does not authorize a request.

To disable access, remove `REMOTE_EXEC_PASSWORD_SHA256` in LILY and redeploy.

This project was created using `bun init` in bun v1.3.2. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
