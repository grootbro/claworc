# Custom Fork Workflow

This repo is set up to work as a custom product fork while still tracking the
official open-source upstream.

## Remotes

Use this layout:

- `origin` -> your fork (`grootbro/claworc`)
- `upstream` -> official repo (`gluk-w/claworc`)

Check:

```bash
git remote -v
```

## Local Overrides

Local-only values live in `.env` and are ignored by git.

Current local defaults:

- `IMAGE_NAMESPACE=grootbro`
- `CLAWORC_DEFAULT_CONTAINER_IMAGE=grootbro/openclaw-vnc-chromium:latest`
- `VITE_PRODUCT_NAME=Ravefox`
- `VITE_PRODUCT_SHORT_NAME=Ravefox`
- `VITE_PRODUCT_TAGLINE=Agent Orchestrator`
- `CLAWORC_DATA_PATH=/Users/dobrota/dev/claworc/data`
- `CLAWORC_DOCKER_HOST=unix:///var/run/docker.sock`

These values are picked up by:

- `make`
- `docker compose`
- `install.sh`
- `uninstall.sh`
- the seeded control-plane default container image

## CI Image Publishing

GitHub Actions in this fork publish into your namespace instead of `glukw/*`.

- By default the workflows use `DOCKERHUB_USERNAME`
- If you want a different namespace, set repository variable `DOCKER_IMAGE_NAMESPACE`
- For custom dashboard branding in CI builds, set repository variables `VITE_PRODUCT_NAME`, `VITE_PRODUCT_SHORT_NAME`, and `VITE_PRODUCT_TAGLINE`
- Keep `DOCKERHUB_TOKEN` configured for `docker/login-action`

## Sync Official Updates

Fast-forward your local `main` from upstream, then push to your fork:

```bash
git checkout main
git fetch upstream
git merge --ff-only upstream/main
git push origin main
```

If your branch already has custom commits, use a normal merge or rebase
instead of `--ff-only`.

## Build Your Images

Build local images:

```bash
make release-local
```

Push your own images:

```bash
make agent-push
make control-plane
```

Because the image namespace is configurable, these builds target your own
registry namespace instead of `glukw/*`.

## Runtime Fixes Already Carried In This Fork

- Agent images install `openclaw` into a user-owned npm prefix so in-app
  updates do not fail on root-owned global installs.
- The agent service enforces `gateway.bind loopback`, which matches current
  OpenClaw validation and avoids legacy bind warnings.
