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

This project was created using `bun init` in bun v1.3.2. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
