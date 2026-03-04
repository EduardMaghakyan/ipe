# Contributing to IPE

Thanks for your interest in contributing! Here's how to get started.

## Prerequisites

- [Bun](https://bun.sh) (latest)

## Setup

```sh
git clone https://github.com/EduardMaghakyan/ipe.git
cd ipe
bun install
```

## Development

Run the UI with Vite dev server and mock API (hot reload, no hook server needed):

```sh
cd packages/ui && bun run dev
```

Opens at `http://localhost:5173` with a sample plan.

Build the standalone binary:

```sh
bun run build
```

## Testing

```sh
bun run test        # unit + integration tests
bun run test:e2e    # Playwright browser tests (requires chromium)
bun run test:all    # everything
```

## Formatting

This project uses Prettier. Format before committing:

```sh
bun run format        # auto-fix
bun run format:check  # check only
```

## Submitting a PR

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `bun run format` and `bun run test`
4. Open a pull request against `main`

## Reporting Issues

Found a bug or have a feature idea? [Open an issue](https://github.com/EduardMaghakyan/ipe/issues).
